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
    },
  ],
  strategy: { id: 'arb-taker', params: {} },
  risk: { minNetMargin: 0.01, matchCapUsd: 0, maxSignalAgeMs: 0 },
  matchExposureCapUsd: 0,
  ...over,
});

const signal = (id: string) => ({
  signalId: id,
  room: 'room:lol:alpha~beta:match-winner',
  sport: 'lol',
  market: 'match-winner',
  teams: ['alpha', 'beta'],
  comboId: 'sptpub>0|polymarket>1',
  phase: 'live',
  margin: 0.06,
  legs: [
    { tenant: 'sptpub', side: 0, pick: 'alpha', odds: 2, ref: { e: '1' } },
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
      book: { tenant: 'sptpub', stake: 25 },
      polymarket: { tokenId: 'tok-1', shares: 50, avgPrice: 0.4, fee: 0.6 },
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
