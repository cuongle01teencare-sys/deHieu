import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type {
  TaskCommandHandler,
  TaskContext,
} from '../../../application/task.js';
import { InMemoryExposureLedger } from '../exposure-ledger.js';
import {
  matchOf,
  TraderArbitrageTask,
  type TraderArbitrageParams,
} from '../trader-arbitrage.task.js';
import type { TraderConfig } from '../trader-config.schema.js';

const TOKEN = 'consumer-token-for-tests';

/** Hub giả: welcome mọi hello đúng token, phát frame tới mọi consumer. */
class FakeHub {
  readonly wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  readonly consumers = new Map<string, WebSocket>();
  readonly acks: string[] = [];
  private _seq = 0;

  constructor() {
    this.wss.on('connection', (ws) =>
      ws.on('message', (raw) => {
        const f = JSON.parse((raw as Buffer).toString('utf8')) as Record<
          string,
          string
        >;
        if (f.type === 'hello') {
          if (f.token !== TOKEN) return ws.close();
          this.consumers.set(f.consumerId, ws);
          ws.send(JSON.stringify({ type: 'welcome', paused: false }));
        } else if (f.type === 'ack') this.acks.push(f.deliveryId);
      }),
    );
  }

  get url() {
    return `ws://127.0.0.1:${(this.wss.address() as AddressInfo).port}`;
  }

  broadcast(frame: Record<string, unknown>) {
    for (const ws of this.consumers.values())
      ws.send(JSON.stringify({ ...frame, deliveryId: `d${++this._seq}` }));
  }

  close() {
    for (const ws of this.consumers.values()) ws.terminate();
    return new Promise((r) => this.wss.close(r));
  }
}

const config = (
  profileId: string,
  over: Partial<TraderConfig> = {},
): TraderConfig => ({
  v: 1,
  profileId,
  profileName: profileId,
  active: true,
  inactiveReason: null,
  mode: 'paper',
  accounts: {
    csgoempire: { id: 'e', label: 'E' },
    polymarket: { id: 'p', label: 'P' },
  },
  stakeTable: [
    {
      tierId: 'std',
      tierName: 'Thường',
      minMargin: 0.02,
      maxMargin: null,
      stake: 25,
      minStake: 5,
      maxStake: 25,
      scaleWithinTier: false,
      enabled: true,
      maxEntries: null,
    },
  ],
  strategy: { id: 'arb-taker', params: {} },
  risk: {
    minNetMargin: 0.01,
    matchCapUsd: 0,
    maxSignalAgeMs: 0,
    maxEntriesPerTier: 1,
    ignoreCancelReasons: ['better_opportunity'],
    markets: null,
  },
  matchExposureCapUsd: 0,
  ...over,
});

const signal = (id: string, margin = 0.06) => ({
  signalId: id,
  room: 'room:lol:alpha~beta:match-winner',
  sport: 'lol',
  market: 'match-winner',
  teams: ['alpha', 'beta'],
  comboId: 'sptpub>0|polymarket>1',
  phase: 'live',
  margin,
  legs: [
    {
      tenant: 'sptpub',
      side: 0,
      pick: 'alpha',
      odds: 2,
      ref: { e: '1', url: 'https://csgoempire.com/match-betting?bt-path=x' },
      startsAt: 1_000_000,
    },
    {
      tenant: 'polymarket',
      side: 1,
      pick: 'beta',
      odds: 2.4,
      ref: { c: 'cond-1', t0: 'tok-0', t1: 'tok-1' },
    },
  ],
  issuedAt: Date.now(),
  expiresAt: Date.now() + 30_000,
});

interface Running {
  emitted: { payload: Record<string, unknown>; channel?: string }[];
  command: (name: string, data: unknown) => Promise<void>;
  stop: () => Promise<void>;
}

function start(
  task: TraderArbitrageTask,
  params: TraderArbitrageParams,
): Running {
  const ac = new AbortController();
  const emitted: Running['emitted'] = [];
  let handler: TaskCommandHandler = () => undefined;
  const ctx: TaskContext<TraderArbitrageParams> = {
    taskId: `trader-${params.profileId}`,
    tenant: 'trader',
    params,
    signal: ac.signal,
    emit: (payload, channel) =>
      emitted.push({ payload: payload as Record<string, unknown>, channel }),
    onCommand: (h) => {
      handler = h;
    },
    warn: () => undefined,
  };
  const done = task.run(ctx);
  return {
    emitted,
    command: async (name, data) => {
      await handler(name, data);
    },
    stop: async () => {
      ac.abort();
      await done;
    },
  };
}

const trades = (r: Running) =>
  r.emitted.filter((e) => e.channel === 'trade').map((e) => e.payload);

const until = async (cond: () => boolean, ms = 3_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('TraderArbitrageTask (giấy)', () => {
  let hub: FakeHub;
  let bookGate: Promise<void> | null;

  beforeEach(async () => {
    process.env.CONSUMER_WS_TOKEN = TOKEN;
    hub = new FakeHub();
    await new Promise((r) => hub.wss.once('listening', r));
    bookGate = null;
    vi.stubGlobal(
      'fetch',
      async (url: string, init?: { signal?: AbortSignal }) => {
        if (url.includes('/book?')) {
          if (bookGate)
            await Promise.race([
              bookGate,
              new Promise((_, rej) =>
                init?.signal?.addEventListener('abort', () =>
                  rej(new Error('aborted')),
                ),
              ),
            ]);
          return Response.json({
            asks: [
              { price: '0.49', size: '1000' },
              { price: '0.40', size: '50' },
            ],
            bids: [],
            min_order_size: '5',
            tick_size: '0.01',
          });
        }
        if (url.includes('/markets?'))
          return Response.json([
            {
              feeSchedule: { exponent: 1, rate: 0.05, takerOnly: true },
              feesEnabled: true,
              orderMinSize: 5,
              orderPriceMinTickSize: 0.01,
              acceptingOrders: true,
            },
          ]);
        throw new Error(`unexpected ${url}`);
      },
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await hub.close();
  });

  const params = (profileId: string): TraderArbitrageParams => ({
    profileId,
    hubUrl: hub.url,
    sharedExposure: false,
  });

  it('chờ cấu hình rồi mới nối hub; ghi lệnh giấy theo sổ lệnh + phí thật', async () => {
    const t = start(new TraderArbitrageTask(), params('A'));
    await until(() => t.emitted.some((e) => e.channel === 'config_request'));
    expect(hub.consumers.size).toBe(0);
    await t.command('config', config('A'));
    await until(() => hub.consumers.has('trader:A'));

    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('s1') });
    await until(() => trades(t).length === 1);
    expect(trades(t)[0]).toMatchObject({
      id: 'A:s1',
      status: 'paper_filled',
      tierName: 'Thường',
      book: {
        tenant: 'sptpub',
        stake: 25,
        url: 'https://csgoempire.com/match-betting?bt-path=x',
      },
      detail: {
        depth: { maxPrice: 0.4, sharesAtEdge: 50 },
        sizing: { targetStake: 25 },
      },
      polymarket: {
        tokenId: 'tok-1',
        shares: 50,
        avgPrice: 0.4,
        fee: 0.6,
        url: null,
      },
      totalCost: 45.6,
      payout: 50,
    });
    const t1 = trades(t)[0];
    expect(t1.legs).toMatchObject([
      {
        venue: 'csgoempire',
        accountId: 'e',
        status: 'simulated',
        requestedAmount: 25,
        avgPrice: 2,
      },
      {
        venue: 'polymarket',
        accountId: 'p',
        status: 'simulated',
        requestedAmount: 50,
        requestedPrice: 0.4,
        marketRef: 'tok-1',
      },
    ]);
    const tm = t1.timing as Record<string, number>;
    expect(tm.receivedAt).toBeGreaterThanOrEqual(tm.signalIssuedAt);
    expect(tm.marketDataAt).toBeGreaterThanOrEqual(tm.receivedAt);
    expect(tm.decidedAt).toBeGreaterThanOrEqual(tm.marketDataAt);
    expect(hub.acks.length).toBe(1);

    // hub gửi lại (ít nhất một lần) → không xử lý lần hai
    hub.broadcast({ type: 'signal', kind: 'refreshed', signal: signal('s1') });
    await new Promise((r) => setTimeout(r, 100));
    expect(trades(t)).toHaveLength(1);
    await t.stop();
  });

  it('kèo hủy rồi phát lại (signalId mới, cùng cửa, cùng hạng) → không vào chồng', async () => {
    const t = start(new TraderArbitrageTask(), params('A'));
    await t.command('config', config('A'));
    await until(() => hub.consumers.has('trader:A'));
    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('r1') });
    await until(() => trades(t).length === 1);
    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('r2') });
    await until(() => trades(t).length === 2);
    expect(trades(t).map((x) => x.status)).toEqual(['paper_filled', 'skipped']);
    expect(String(trades(t)[1].reason)).toMatch(/^ALREADY_ENTERED/);
    await t.stop();
  });

  it('mỗi hạng tính riêng: cùng cửa lên hạng cao hơn thì vào tiếp', async () => {
    const vip = {
      tierId: 'vip',
      tierName: 'VIP',
      minMargin: 0.05,
      maxMargin: null,
      stake: 25,
      minStake: 5,
      maxStake: 25,
      scaleWithinTier: false,
      enabled: true,
      maxEntries: null,
    };
    const std = {
      ...vip,
      tierId: 'std',
      tierName: 'Thường',
      minMargin: 0.02,
      maxMargin: 0.05,
    };
    const t = start(new TraderArbitrageTask(), params('A'));
    await t.command('config', config('A', { stakeTable: [std, vip] }));
    await until(() => hub.consumers.has('trader:A'));
    const send = async (id: string, m: number, n: number) => {
      hub.broadcast({ type: 'signal', kind: 'issued', signal: signal(id, m) });
      await until(() => trades(t).length === n);
    };
    await send('m1', 0.03, 1); // Thường
    await send('m2', 0.06, 2); // lên VIP → vào
    await send('m3', 0.035, 3); // tụt về Thường → đã vào hạng này
    await send('m4', 0.07, 4); // VIP lần 2 → đã vào hạng này
    expect(trades(t).map((x) => [x.tierName, x.status])).toEqual([
      ['Thường', 'paper_filled'],
      ['VIP', 'paper_filled'],
      ['Thường', 'skipped'],
      ['VIP', 'skipped'],
    ]);
    await t.stop();
  });

  it('cấu hình số lệnh mỗi hạng: 2 → vào 2 lần rồi bỏ qua', async () => {
    const t = start(new TraderArbitrageTask(), params('A'));
    await t.command(
      'config',
      config('A', {
        risk: {
          minNetMargin: 0.01,
          matchCapUsd: 0,
          maxSignalAgeMs: 0,
          maxEntriesPerTier: 2,
          ignoreCancelReasons: [],
          markets: null,
        },
      }),
    );
    await until(() => hub.consumers.has('trader:A'));
    for (const [i, id] of ['q1', 'q2', 'q3'].entries()) {
      hub.broadcast({ type: 'signal', kind: 'issued', signal: signal(id) });
      await until(() => trades(t).length === i + 1);
    }
    expect(trades(t).map((x) => x.status)).toEqual([
      'paper_filled',
      'paper_filled',
      'skipped',
    ]);
    await t.stop();
  });

  it('số lệnh riêng của hạng ghi đè mặc định profile (hạng 3 lệnh, mặc định 1)', async () => {
    const t = start(new TraderArbitrageTask(), params('A'));
    const base = config('A');
    await t.command(
      'config',
      config('A', {
        stakeTable: base.stakeTable.map((r) => ({ ...r, maxEntries: 3 })),
      }),
    );
    await until(() => hub.consumers.has('trader:A'));
    for (const [i, id] of ['e1', 'e2', 'e3', 'e4'].entries()) {
      hub.broadcast({ type: 'signal', kind: 'issued', signal: signal(id) });
      await until(() => trades(t).length === i + 1);
    }
    expect(trades(t).map((x) => x.status)).toEqual([
      'paper_filled',
      'paper_filled',
      'paper_filled',
      'skipped',
    ]);
    // tăng số lệnh của hạng → cửa đang bị chặn được xét lại
    await t.command(
      'config',
      config('A', {
        stakeTable: base.stakeTable.map((r) => ({ ...r, maxEntries: 4 })),
      }),
    );
    await until(() => trades(t).length === 5);
    expect(trades(t)[4]).toMatchObject({
      id: 'A:e4:2',
      status: 'paper_filled',
    });
    await t.stop();
  });

  it('hủy vì có kèo tốt hơn → vẫn vào tiếp lệnh đang tính', async () => {
    let open!: () => void;
    bookGate = new Promise<void>((r) => (open = r));
    const t = start(new TraderArbitrageTask(), params('A'));
    await t.command('config', config('A'));
    await until(() => hub.consumers.has('trader:A'));
    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('b1') });
    await new Promise((r) => setTimeout(r, 50));
    hub.broadcast({
      type: 'cancel',
      signalId: 'b1',
      room: 'x',
      comboId: 'x',
      reason: 'better_opportunity',
    });
    await new Promise((r) => setTimeout(r, 50));
    open();
    await until(() => trades(t).length === 1);
    expect(trades(t)[0]).toMatchObject({ status: 'paper_filled' });
    await t.stop();
  });

  it('mọi trader nhận cùng kèo; giới hạn tổng theo trận áp cho tất cả', async () => {
    const ledger = new InMemoryExposureLedger();
    const a = start(new TraderArbitrageTask({ ledger }), params('A'));
    const b = start(new TraderArbitrageTask({ ledger }), params('B'));
    await a.command('config', config('A', { matchExposureCapUsd: 60 }));
    await b.command('config', config('B', { matchExposureCapUsd: 60 }));
    await until(() => hub.consumers.size === 2);

    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('s2') });
    await until(() => trades(a).length === 1 && trades(b).length === 1);
    const all = [...trades(a), ...trades(b)];
    const filled = all.filter((x) => x.status === 'paper_filled');
    expect(filled.length).toBeGreaterThanOrEqual(1);
    const spent = filled.reduce((s, x) => s + (x.totalCost as number), 0);
    expect(spent).toBeLessThanOrEqual(60 + 1e-9);
    for (const x of all.filter((y) => y.status !== 'paper_filled'))
      expect(String(x.reason)).toMatch(/^CAP_REACHED|^BUDGET_EXHAUSTED/);
    await a.stop();
    await b.stop();
  });

  it('kèo bị hủy vì lệch giờ khi đang tính → ghi giờ từng chân lúc hủy + giờ lúc phát', async () => {
    let open!: () => void;
    bookGate = new Promise<void>((r) => (open = r));
    const t = start(new TraderArbitrageTask(), params('A'));
    await t.command('config', config('A'));
    await until(() => hub.consumers.has('trader:A'));
    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('s7') });
    await new Promise((r) => setTimeout(r, 50));
    const detail = {
      startTimes: [
        { tenant: 'sptpub', startsAt: 1_000_000 + 2_700_000 },
        { tenant: 'polymarket', startsAt: 1_000_000 },
      ],
      startDriftMs: 2_700_000,
      maxStartDriftMs: 1_200_000,
    };
    hub.broadcast({
      type: 'cancel',
      signalId: 's7',
      room: 'room:lol:alpha~beta:match-winner',
      comboId: 'x',
      reason: 'start_time_mismatch',
      detail,
    });
    await until(() => trades(t).length === 1);
    expect(trades(t)[0]).toMatchObject({
      status: 'cancelled',
      book: { startsAt: 1_000_000 },
      polymarket: { startsAt: null },
      detail: {
        cancel: { reason: 'start_time_mismatch', ignored: false, detail },
      },
    });
    open();
    await t.stop();
  });

  it('kèo bị hủy khi đang đọc sổ lệnh → cancelled, không vào lệnh', async () => {
    let open!: () => void;
    bookGate = new Promise<void>((r) => (open = r));
    const t = start(new TraderArbitrageTask(), params('A'));
    await t.command('config', config('A'));
    await until(() => hub.consumers.has('trader:A'));

    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('s3') });
    await new Promise((r) => setTimeout(r, 50));
    hub.broadcast({
      type: 'cancel',
      signalId: 's3',
      room: 'room:lol:alpha~beta:match-winner',
      comboId: 'x',
      reason: 'margin_decreased',
    });
    await until(() => trades(t).length === 1);
    expect(trades(t)[0]).toMatchObject({ status: 'cancelled' });
    expect(String(trades(t)[0].reason)).toContain('margin_decreased');
    open();
    await t.stop();
  });

  it('hạng không được chọn trong profile → bỏ qua TIER_NOT_SELECTED', async () => {
    const t = start(new TraderArbitrageTask(), params('A'));
    const base = config('A');
    await t.command(
      'config',
      config('A', {
        stakeTable: base.stakeTable.map((r) => ({ ...r, enabled: false })),
      }),
    );
    await until(() => hub.consumers.has('trader:A'));
    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('s5') });
    await until(() => trades(t).length === 1);
    expect(trades(t)[0]).toMatchObject({
      status: 'skipped',
      tierName: 'Thường',
    });
    expect(trades(t)[0]?.reason).toMatch(/^TIER_NOT_SELECTED:/);
    await t.stop();
  });

  it('market không được chọn trong profile → bỏ qua MARKET_NOT_SELECTED', async () => {
    const t = start(new TraderArbitrageTask(), params('A'));
    const base = config('A');
    await t.command(
      'config',
      config('A', { risk: { ...base.risk, markets: ['map-handicap-p1.5'] } }),
    );
    await until(() => hub.consumers.has('trader:A'));
    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('s6') });
    await until(() => trades(t).length === 1);
    expect(trades(t)[0]?.status).toBe('skipped');
    expect(trades(t)[0]?.reason).toMatch(/^MARKET_NOT_SELECTED:/);
    await t.stop();
  });

  it('hạng chồng nhau: chỉ chọn trong hạng được tick (VIP không tick, VIP-auto tick → vào VIP-auto)', async () => {
    const row = {
      maxEntries: null,
      minStake: 5,
      maxStake: 25,
      stake: 25,
      scaleWithinTier: false,
      maxMargin: null,
    };
    const t = start(new TraderArbitrageTask(), params('A'));
    await t.command(
      'config',
      config('A', {
        stakeTable: [
          // VIP cận dưới cao hơn nhưng không tick → không được chọn
          {
            ...row,
            tierId: 'vip',
            tierName: 'VIP',
            minMargin: 0.03,
            enabled: false,
          },
          {
            ...row,
            tierId: 'auto',
            tierName: 'VIP auto',
            minMargin: 0.02,
            enabled: true,
          },
        ],
      }),
    );
    await until(() => hub.consumers.has('trader:A'));
    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('s8') });
    await until(() => trades(t).length === 1);
    expect(trades(t)[0]).toMatchObject({ tierName: 'VIP auto' });
    expect(trades(t)[0]?.reason ?? '').not.toMatch(/TIER_NOT_SELECTED/);
    await t.stop();
  });

  it('đổi cấu hình → kèo còn sống bị bỏ qua vì cấu hình được xét lại một lần (id mới)', async () => {
    const t = start(new TraderArbitrageTask(), params('A'));
    const base = config('A');
    await t.command(
      'config',
      config('A', { risk: { ...base.risk, markets: ['map-handicap-p1.5'] } }),
    );
    await until(() => hub.consumers.has('trader:A'));
    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('s9') });
    await until(() => trades(t).length === 1);
    expect(trades(t)[0]?.reason).toMatch(/^MARKET_NOT_SELECTED/);

    // đổi phần cấu hình KHÔNG liên quan → không xét lại
    await t.command(
      'config',
      config('A', {
        risk: {
          ...base.risk,
          markets: ['map-handicap-p1.5'],
          maxSignalAgeMs: 1,
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(trades(t)).toHaveLength(1);

    // mở market → xét lại ngay, không cần kèo phát mới
    await t.command('config', config('A'));
    await until(() => trades(t).length === 2);
    expect(trades(t)[1]).toMatchObject({
      id: 'A:s9:2',
      status: 'paper_filled',
    });
    // cấu hình gửi lại y hệt → không xét lại nữa
    await t.command('config', config('A'));
    await new Promise((r) => setTimeout(r, 80));
    expect(trades(t)).toHaveLength(2);
    await t.stop();
  });

  it('task khởi động lại vẫn biết kết quả cũ (lưu trong sổ): đổi cấu hình → xét lại, không đổi → im', async () => {
    const ledger = new InMemoryExposureLedger();
    const base = config('A');
    const closed = config('A', {
      risk: { ...base.risk, markets: ['map-handicap-p1.5'] },
    });
    const t1 = start(new TraderArbitrageTask({ ledger }), params('A'));
    await t1.command('config', closed);
    await until(() => hub.consumers.has('trader:A'));
    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('s11') });
    await until(() => trades(t1).length === 1);
    expect(trades(t1)[0]?.reason).toMatch(/^MARKET_NOT_SELECTED/);
    await t1.stop();
    hub.consumers.delete('trader:A'); // hub giả không tự gỡ consumer đã ngắt

    // khởi động lại, cấu hình y hệt → hub gửi lại kèo → không xét lại
    const t2 = start(new TraderArbitrageTask({ ledger }), params('A'));
    await t2.command('config', closed);
    await until(() => hub.consumers.has('trader:A'));
    hub.broadcast({ type: 'signal', kind: 'refreshed', signal: signal('s11') });
    await new Promise((r) => setTimeout(r, 80));
    expect(trades(t2)).toHaveLength(0);
    // mở market → xét lại ngay theo kết quả đọc từ sổ, id tiếp theo
    await t2.command('config', base);
    await until(() => trades(t2).length === 1);
    expect(trades(t2)[0]).toMatchObject({
      id: 'A:s11:2',
      status: 'paper_filled',
    });
    await t2.stop();
  });

  it('dấu cũ chưa có kết quả (trước bản này) → xét lại một lần rồi thôi', async () => {
    const ledger = new InMemoryExposureLedger();
    await ledger.claim('A', 's12', 60_000); // dấu "1" do bản cũ ghi
    const t = start(new TraderArbitrageTask({ ledger }), params('A'));
    await t.command('config', config('A'));
    await until(() => hub.consumers.has('trader:A'));
    hub.broadcast({ type: 'signal', kind: 'refreshed', signal: signal('s12') });
    await until(() => trades(t).length === 1);
    expect(trades(t)[0]).toMatchObject({
      id: 'A:s12:2',
      status: 'paper_filled',
    });
    hub.broadcast({ type: 'signal', kind: 'refreshed', signal: signal('s12') });
    await new Promise((r) => setTimeout(r, 80));
    expect(trades(t)).toHaveLength(1);
    await t.stop();
  });

  it('reset_seen (app xóa toàn bộ lệnh) → xét lại mọi kèo còn sống', async () => {
    const t = start(new TraderArbitrageTask(), params('A'));
    await t.command('config', config('A'));
    await until(() => hub.consumers.has('trader:A'));
    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('s10') });
    await until(() => trades(t).length === 1);
    // hub gửi lại cùng kèo → vẫn chỉ xử lý một lần
    hub.broadcast({ type: 'signal', kind: 'refreshed', signal: signal('s10') });
    await new Promise((r) => setTimeout(r, 80));
    expect(trades(t)).toHaveLength(1);
    await t.command('reset_seen', {});
    await until(() => trades(t).length === 2);
    // đã vào ở hạng này rồi → lần xét lại báo cửa đã vào, không vào trùng
    expect(trades(t)[1]).toMatchObject({ id: 'A:s10:2', status: 'skipped' });
    expect(String(trades(t)[1]?.reason)).toMatch(/^ALREADY_ENTERED/);
    await t.stop();
  });

  it('profile tắt → ghi bỏ qua kèm lý do', async () => {
    const t = start(new TraderArbitrageTask(), params('A'));
    await t.command(
      'config',
      config('A', { active: false, inactiveReason: 'PROFILE_DISABLED' }),
    );
    await until(() => hub.consumers.has('trader:A'));
    hub.broadcast({ type: 'signal', kind: 'issued', signal: signal('s4') });
    await until(() => trades(t).length === 1);
    expect(trades(t)[0]).toMatchObject({
      status: 'skipped',
      reason: 'INACTIVE: PROFILE_DISABLED',
    });
    await t.stop();
  });

  it('cấu hình sai profile bị từ chối', async () => {
    const t = start(new TraderArbitrageTask(), params('A'));
    await expect(t.command('config', config('B'))).rejects.toThrow(
      /PROFILE_MISMATCH/,
    );
    await t.stop();
  });

  it('matchOf gộp mọi market của cùng trận', () => {
    expect(matchOf('room:cs2:a~b:map-1-winner')).toBe('cs2:a~b');
  });
});
