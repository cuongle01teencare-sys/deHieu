import type { TaskDataMessage } from '../../../../tasks/application/task-protocol.js';
import { TeamNameResolver } from '../../../application/team-name.resolver.js';
import type { TeamAliasRepository } from '../../../domain/team-alias.repository.js';
import { SptPubOddsTranslator } from '../sptpub/sptpub-odds.translator.js';
import { PolymarketOddsTranslator } from '../polymarket/polymarket-odds.translator.js';
import { IngestStats } from '../../../application/ingest-stats.js';

const repo: TeamAliasRepository = {
  findAll: () => Promise.resolve({ status: 'SUCEED', data: [] }),
  findById: () => Promise.resolve({ status: 'NOT_FOUND' }),
  save: (a) => Promise.resolve({ status: 'SUCEED', data: a }),
  delete: () => Promise.resolve({ status: 'SUCEED', data: true }),
};
const teams = new TeamNameResolver(repo);

let seq = 0;
const msg = (p: Partial<TaskDataMessage>): TaskDataMessage => ({
  taskId: 'sptpub-live',
  tenant: 'sptpub',
  kind: 'sptpub.live',
  seq: ++seq,
  sentAt: 1,
  receivedAt: 1,
  payload: {},
  ...p,
});
const event = (id: string, k1 = '1.5', k2 = '2.5') => ({
  [id]: {
    desc: {
      scheduled: 1790326800,
      type: 'match',
      sport: '109',
      competitors: [
        { id: 'a', name: `Team ${id}A` },
        { id: 'b', name: `${id}B Esports` },
      ],
    },
    markets: { '186': { '': { '4': { k: k1 }, '5': { k: k2 } } } },
  },
});

describe('SptPubOddsTranslator', () => {
  it('preserves the source URL from feed slugs through odds-only deltas', async () => {
    const t = new SptPubOddsTranslator(teams);
    const id = '2721501408921788440';
    const ev = event(id)[id];
    await t.translate(
      msg({
        payload: {
          version: 1,
          sports: { '109': { slug: 'counter-strike' } },
          categories: { c: { slug: 'counter-strike' } },
          tournaments: { t: { slug: 'original-league' } },
        },
      }),
    );
    const [first] = await t.translate(
      msg({
        payload: {
          version: 2,
          events: {
            [id]: {
              ...ev,
              desc: {
                ...ev.desc,
                slug: 'original-home-original-away',
                category: 'c',
                tournament: 't',
              },
            },
          },
        },
      }),
    );
    if (first?.type !== 'set') throw new Error('expected set');
    expect(new URL(first.line.props.ref.url).searchParams.get('bt-path')).toBe(
      `/counter-strike/counter-strike/original-league/original-home-original-away-${id}`,
    );
    const [delta] = await t.translate(
      msg({
        payload: {
          version: 3,
          events: {
            [id]: { markets: { '186': { '': { '4': { k: '1.7' } } } } },
          },
        },
      }),
    );
    expect(delta?.type === 'set' && delta.line.props.ref.url).toBe(
      first.line.props.ref.url,
    );
  });

  it('thứ tự trận trong giải: gom trận cùng giải, xếp theo giờ bắt đầu → ref tour/tno/tof', async () => {
    const t = new SptPubOddsTranslator(teams);
    const mk = (id: string, scheduled: number, tournament: string) => {
      const e = event(id)[id];
      return { [id]: { ...e, desc: { ...e.desc, scheduled, tournament } } };
    };
    await t.translate(
      msg({
        channel: 'snapshot',
        payload: {
          version: 1,
          tournaments: { t1: { slug: 'iem-cologne' } },
          events: {
            ...mk('900', 3_000, 't1'),
            ...mk('901', 1_000, 't1'),
            ...mk('902', 2_000, 't2'),
          },
        },
      }),
    );
    const out = await t.translate(
      msg({ payload: { version: 2, events: mk('900', 3_000, 't1') } }),
    );
    const ref = out[0]?.type === 'set' ? out[0].line.props.ref : null;
    expect(ref).toMatchObject({ tour: 'iem-cologne', tno: '2', tof: '2' });
  });

  it('đưa odds về thứ tự đội của room, ref mang id gốc', async () => {
    const t = new SptPubOddsTranslator(teams);
    const [c] = await t.translate(
      msg({
        channel: 'delta',
        payload: { version: 1, events: event('Z', '1.5', '2.5') },
      }),
    );
    expect(c).toMatchObject({ type: 'set' });
    if (c?.type !== 'set') return;
    // 'zb' < 'za'? không: 'za' < 'zb' → competitor1 (za) là teams[0]
    expect(c.key.toString()).toBe('room:cs2:za~zb:game-winner');
    expect(c.line.props.odds).toEqual([1.5, 2.5]);
    expect(c.line.props.ref).toMatchObject({
      e: 'Z',
      m: '186',
      o0: '4',
      o1: '5',
    });
  });

  it('kênh resync (phần lệch sau khi task tự tải lại snapshot) cập nhật giá và gỡ market như delta', async () => {
    const t = new SptPubOddsTranslator(teams);
    await t.translate(
      msg({
        channel: 'snapshot',
        payload: { version: 1, events: event('Q', '2.58', '1.45') },
      }),
    );
    const [c] = await t.translate(
      msg({
        channel: 'resync',
        payload: {
          version: 2,
          events: {
            Q: {
              markets: {
                '186': { '': { '4': { k: '2.62' }, '5': { k: '1.47' } } },
              },
            },
          },
          resync: { events: 1, at: 1 },
        },
      }),
    );
    expect(c?.type === 'set' && [...c.line.props.odds].sort()).toEqual([
      1.47, 2.62,
    ]);
    const removed = await t.translate(
      msg({
        channel: 'resync',
        payload: { version: 3, events: { Q: { markets: { '186': null } } } },
      }),
    );
    expect(removed.map((x) => x.type)).toEqual(['remove']);
  });

  it('chụp lại snapshot: ghi đè giá cũ, gỡ market vắng mặt dù trận vẫn còn (sptpub không gửi delta gỡ)', async () => {
    const t = new SptPubOddsTranslator(teams);
    const withMap = (k1: string, k2: string, map: boolean) => {
      const e = event('R', k1, k2);
      if (map)
        (e.R.markets as Record<string, unknown>)['330'] = {
          'mapnr=1': { '4': { k: '2' }, '5': { k: '1.8' } },
        };
      return e;
    };
    const snapshot = async (events: Record<string, unknown>) => {
      await t.translate(
        msg({ channel: 'snapshot-start', payload: { feed: 'live' } }),
      );
      return t.translate(
        msg({
          channel: 'snapshot',
          payload: { version: 1, snapshot_complete: true, events },
        }),
      );
    };
    const first = await snapshot(withMap('2.58', '1.45', true));
    expect(first.filter((c) => c.type === 'set')).toHaveLength(2);

    // sptpub đổi giá + gỡ market 330 mà KHÔNG gửi delta; lần chụp lại sau mới thấy
    const again = await snapshot(withMap('2.62', '1.47', false));
    const set = again.find((c) => c.type === 'set');
    expect(set?.type === 'set' && [...set.line.props.odds].sort()).toEqual([
      1.47, 2.62,
    ]);
    expect(
      again.filter((c) => c.type === 'remove').map((c) => c.key.market),
    ).toEqual(['map-1-winner']);
  });

  it('outcome bị khóa (b:1) → dòng suspended', async () => {
    const t = new SptPubOddsTranslator(teams);
    await t.translate(msg({ payload: { version: 1, events: event('Q') } }));
    const [c] = await t.translate(
      msg({
        payload: {
          version: 2,
          events: {
            Q: { markets: { '186': { '': { '4': { k: '0.0', b: 1 } } } } },
          },
        },
      }),
    );
    expect(c?.type === 'set' && c.line.props.status).toBe('suspended');
  });

  it('snapshot mới không còn trận cũ → gỡ trận đó', async () => {
    const t = new SptPubOddsTranslator(teams);
    await t.translate(
      msg({
        payload: { version: 1, events: { ...event('A'), ...event('B') } },
      }),
    );
    await t.translate(msg({ channel: 'snapshot-start', payload: {} }));
    const changes = await t.translate(
      msg({
        channel: 'snapshot',
        payload: { version: 9, snapshot_complete: true, events: event('A') },
      }),
    );
    expect(
      changes.filter((c) => c.type === 'remove').map((c) => c.key.toString()),
    ).toEqual(['room:cs2:ba~bb:game-winner']);
  });

  it('release(task) chỉ gỡ trận do đúng task đó sở hữu', async () => {
    const t = new SptPubOddsTranslator(teams);
    await t.translate(
      msg({
        taskId: 'sptpub-live',
        payload: { version: 1, events: event('L') },
      }),
    );
    await t.translate(
      msg({
        taskId: 'sptpub-prematch',
        payload: { version: 1, events: event('P') },
      }),
    );
    const changes = await t.release('sptpub-live', 'sptpub.live');
    expect(changes.map((c) => `${c.type}:${c.key.toString()}`)).toEqual([
      'remove:room:cs2:la~lb:game-winner',
    ]);
    expect(await t.release('sptpub-live', 'sptpub.live')).toEqual([]);
  });

  it('prematch gửi null cho trận đã chuyển sang live → không gỡ dòng của live', async () => {
    const t = new SptPubOddsTranslator(teams);
    await t.translate(
      msg({
        taskId: 'sptpub-prematch',
        payload: { version: 1, events: event('L') },
      }),
    );
    await t.translate(
      msg({
        taskId: 'sptpub-live',
        payload: { version: 1, events: event('L') },
      }),
    );
    const changes = await t.translate(
      msg({
        taskId: 'sptpub-prematch',
        payload: { version: 2, events: { L: null } },
      }),
    );
    expect(changes).toEqual([]);
  });
});

describe('PolymarketOddsTranslator', () => {
  const events = [
    {
      id: '1',
      slug: 'cs2-x',
      schedule: { startTime: '2026-09-25T09:00:00Z' },
      sports: { sport: { sport: 'cs2' } },
      markets: [
        {
          conditionId: '0xc',
          slug: 'cs2-x',
          state: { closed: false, acceptingOrders: true },
          outcomes: {
            yes: { label: 'Sinners', tokenId: 'tS' },
            no: { label: 'Alliance', tokenId: 'tA' },
          },
          prices: { bestBid: '0.40', bestAsk: '0.50' },
          sports: { sportsMarketType: 'moneyline' },
        },
      ],
    },
  ];

  it('links to the event slug, not a child market slug, including stream updates', async () => {
    const t = new PolymarketOddsTranslator(teams);
    const [first] = await t.translate(
      msg({
        tenant: 'polymarket',
        kind: 'polymarket.descriptor',
        payload: [
          {
            ...events[0],
            slug: 'original-event',
            markets: [{ ...events[0].markets[0], slug: 'child-market' }],
          },
        ],
      }),
    );
    if (first?.type !== 'set') throw new Error('expected set');
    expect(first.line.props.ref.url).toBe(
      'https://polymarket.com/event/original-event',
    );
    expect(first.line.props.ref.slug).toBe('child-market');
    const [delta] = await t.translate(
      msg({
        tenant: 'polymarket',
        kind: 'polymarket.stream',
        payload: {
          topic: 'market',
          type: 'price_change',
          payload: { priceChanges: [{ assetId: 'tA', bestAsk: '0.25' }] },
        },
      }),
    );
    expect(delta?.type === 'set' && delta.line.props.ref.url).toBe(
      first.line.props.ref.url,
    );
  });

  it('thứ tự trận trong giải theo series của event → ref tour/tno/tof', async () => {
    const t = new PolymarketOddsTranslator(teams);
    const ev = (id: string, start: string, cond: string) => ({
      ...events[0],
      id,
      schedule: { startTime: start },
      series: [{ id: 77, slug: 'cs2-iem', title: 'IEM Cologne' }],
      markets: [{ ...events[0].markets[0], conditionId: cond }],
    });
    const out = await t.translate(
      msg({
        tenant: 'polymarket',
        kind: 'polymarket.descriptor',
        payload: [
          ev('a', '2026-09-25T12:00:00Z', '0x1'),
          ev('b', '2026-09-25T09:00:00Z', '0x2'),
        ],
      }),
    );
    const refs = out.flatMap((c) =>
      c.type === 'set' ? [c.line.props.ref] : [],
    );
    expect(refs.find((r) => r.c === '0x2')).toMatchObject({
      tour: 'IEM Cologne',
      tno: '1',
      tof: '2',
    });
    // đếm cả trang trước khi phát: event 'a' (đứng đầu trang) cũng thấy đủ 2 trận
    expect(refs.find((r) => r.c === '0x1')).toMatchObject({
      tno: '2',
      tof: '2',
    });
    const again = await t.translate(
      msg({
        tenant: 'polymarket',
        kind: 'polymarket.descriptor',
        payload: [ev('a', '2026-09-25T12:00:00Z', '0x1')],
      }),
    );
    expect(again[0]?.type === 'set' && again[0].line.props.ref).toMatchObject({
      tno: '2',
      tof: '2',
    });
  });

  it('đảo token theo thứ tự đội của room và yêu cầu subscribe token', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const t = new PolymarketOddsTranslator(teams, sync);
    const [c] = await t.translate(
      msg({
        tenant: 'polymarket',
        kind: 'polymarket.descriptor',
        payload: events,
      }),
    );
    if (c?.type !== 'set') throw new Error('expected set');
    expect(c.key.toString()).toBe('room:cs2:alliance~sinners:game-winner');
    expect(c.line.props.ref).toMatchObject({ t0: 'tA', t1: 'tS' });
    expect(c.line.props.odds[0]).toBeCloseTo(1 / 0.6); // alliance = 1 - bestBid(yes)
    expect(c.line.props.odds[1]).toBeCloseTo(2); // sinners = bestAsk(yes)
    expect(sync).toHaveBeenCalledWith('subscribe', ['tA', 'tS']);
  });

  it('giá 1 / 0 (market sắp đóng, không có lệnh) → dòng suspended, không ném lỗi', async () => {
    const t = new PolymarketOddsTranslator(teams);
    const edge = [
      {
        ...events[0],
        markets: [
          { ...events[0].markets[0], prices: { bestBid: '0', bestAsk: '1' } },
        ],
      },
    ];
    const [c] = await t.translate(
      msg({
        tenant: 'polymarket',
        kind: 'polymarket.descriptor',
        payload: edge,
      }),
    );
    expect(c?.type === 'set' && c.line.props.status).toBe('suspended');
    const [d] = await t.translate(
      msg({
        tenant: 'polymarket',
        kind: 'polymarket.stream',
        payload: {
          topic: 'market',
          type: 'price_change',
          payload: { priceChanges: [{ assetId: 'tA', bestAsk: '0.49' }] },
        },
      }),
    );
    // mới có giá một bên → vẫn suspended
    expect(d?.type === 'set' && d.line.props.status).toBe('suspended');
  });

  it('price_change cập nhật odds = 1 / best ask của token', async () => {
    const t = new PolymarketOddsTranslator(teams);
    await t.translate(
      msg({
        tenant: 'polymarket',
        kind: 'polymarket.descriptor',
        payload: events,
      }),
    );
    const [c] = await t.translate(
      msg({
        tenant: 'polymarket',
        kind: 'polymarket.stream',
        payload: {
          topic: 'market',
          type: 'price_change',
          payload: { priceChanges: [{ assetId: 'tA', bestAsk: '0.25' }] },
        },
      }),
    );
    expect(c?.type === 'set' && c.line.props.odds[0]).toBe(4);
  });

  const informationalEvents = [
    {
      type: 'last_trade_price',
      payload: { assetId: 'tA', price: '0.05', side: 'BUY', size: '20' },
    },
    {
      type: 'tick_size_change',
      payload: { assetId: 'tA', oldTickSize: '0.01', newTickSize: '0.001' },
    },
    {
      type: 'new_market',
      payload: { id: '2', market: '0xnew', assetIds: ['new-a', 'new-b'] },
    },
  ];

  it.each(informationalEvents)(
    '$type hợp lệ được bỏ qua, không báo lỗi parse và không đổi odds',
    async (event) => {
      const stats = new IngestStats();
      const t = new PolymarketOddsTranslator(
        teams,
        undefined,
        stats.reporter('polymarket'),
      );
      await t.translate(
        msg({ kind: 'polymarket.descriptor', payload: events }),
      );
      expect(
        await t.translate(
          msg({
            kind: 'polymarket.stream',
            payload: { topic: 'market', ...event },
          }),
        ),
      ).toEqual([]);
      expect(stats.snapshot().items[0]?.skipped).toEqual({
        unsupported_event: 1,
      });

      const [change] = await t.translate(
        msg({
          kind: 'polymarket.stream',
          payload: {
            topic: 'market',
            type: 'best_bid_ask',
            payload: { assetId: 'tS', bestAsk: '0.25' },
          },
        }),
      );
      if (change?.type !== 'set') throw new Error('expected set');
      expect(change.line.props.odds[0]).toBeCloseTo(1 / 0.6);
      expect(change.line.props.odds[1]).toBe(4);
    },
  );

  it.each([
    ...informationalEvents.map((e) => ({ type: e.type, payload: {} })),
    { type: 'book', payload: { assetId: 'tA', asks: 'invalid' } },
    { type: 'price_change', payload: { priceChanges: [{ bestAsk: '0.2' }] } },
    { type: 'best_bid_ask', payload: { bestAsk: '0.2' } },
    {
      type: 'last_trade_price',
      payload: { assetId: 'tA', price: 'invalid', side: 'BUY' },
    },
    {
      type: 'tick_size_change',
      payload: { assetId: 'tA', newTickSize: 'invalid' },
    },
    {
      type: 'price_change',
      payload: { priceChanges: [{ assetId: 'tA', bestAsk: 'invalid' }] },
    },
    { type: 'future_event', payload: {} },
  ])('$type sai schema vẫn được đếm parse_failed', async (event) => {
    const skip = vi.fn();
    const t = new PolymarketOddsTranslator(teams, undefined, skip);
    expect(
      await t.translate(
        msg({
          kind: 'polymarket.stream',
          payload: { topic: 'market', ...event },
        }),
      ),
    ).toEqual([]);
    expect(skip).toHaveBeenCalledExactlyOnceWith(
      'polymarket.stream',
      'parse_failed',
    );
  });

  it('book lấy ask thấp nhất; sổ lệnh rỗng khóa dòng; market_resolved gỡ dòng', async () => {
    const t = new PolymarketOddsTranslator(teams);
    await t.translate(msg({ kind: 'polymarket.descriptor', payload: events }));
    const stream = (type: string, payload: unknown) =>
      t.translate(
        msg({
          kind: 'polymarket.stream',
          payload: { topic: 'market', type, payload },
        }),
      );
    const [priced] = await stream('book', {
      assetId: 'tA',
      asks: [{ price: '0.4' }, { price: '0.2' }],
    });
    expect(priced?.type === 'set' && priced.line.props.odds[0]).toBe(5);
    const [empty] = await stream('book', { assetId: 'tA', asks: [] });
    expect(empty?.type === 'set' && empty.line.props.status).toBe('suspended');
    const resolved = await stream('market_resolved', {
      assetIds: ['tA', 'tS'],
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ type: 'remove', tenant: 'polymarket' });
    expect(
      await stream('best_bid_ask', { assetId: 'tA', bestAsk: '0.3' }),
    ).toEqual([]);
  });

  it('task stream chết → gỡ dòng; task events chết → gỡ market và unsubscribe token', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const t = new PolymarketOddsTranslator(teams, sync);
    await t.translate(
      msg({
        taskId: 'poly-events',
        tenant: 'polymarket',
        kind: 'polymarket.descriptor',
        payload: events,
      }),
    );

    expect(
      (await t.release('poly-stream', 'polymarket.stream')).map((c) => c.type),
    ).toEqual(['remove']);
    expect(
      (await t.release('poly-events', 'polymarket.descriptor')).map(
        (c) => c.type,
      ),
    ).toEqual(['remove']);
    expect(sync).toHaveBeenLastCalledWith('unsubscribe', ['tA', 'tS']);
  });
});

describe('map handicap', () => {
  /** sptpub: competitor1 = Sinners, competitor2 = Alliance (→ teams[0] = alliance, c1 KHÔNG đứng trước). */
  const sptEvent = (markets: Record<string, unknown>) => ({
    H: {
      desc: {
        scheduled: 1790326800,
        type: 'match',
        sport: '109',
        competitors: [
          { id: 'a', name: 'Sinners Esports' },
          { id: 'b', name: 'Alliance' },
        ],
      },
      markets,
    },
  });
  const spt = (taskId = 'sptpub-live') => ({
    taskId,
    channel: 'delta' as const,
  });

  /** polymarket: yes = Sinners chấp `line`. */
  const polyEvents = (line: number) => [
    {
      id: '1',
      slug: 'cs2-x',
      schedule: { startTime: '2026-09-25T09:00:00Z' },
      sports: { sport: { sport: 'cs2' } },
      markets: [
        {
          conditionId: '0xh',
          slug: 'cs2-x-map-handicap',
          state: { closed: false, acceptingOrders: true },
          outcomes: {
            yes: { label: 'Sinners', tokenId: 'tS' },
            no: { label: 'Alliance', tokenId: 'tA' },
          },
          prices: { bestBid: '0.40', bestAsk: '0.50' },
          sports: { sportsMarketType: 'map_handicap', line },
        },
      ],
    },
  ];

  it('sptpub: quy hcp của competitor1 về teams[0], đảo odds; mức không hỗ trợ bị bỏ', async () => {
    const t = new SptPubOddsTranslator(teams);
    const changes = await t.translate(
      msg({
        ...spt(),
        payload: {
          version: 1,
          events: sptEvent({
            '327': {
              'hcp=-1.5': { '1714': { k: '2.1' }, '1715': { k: '1.7' } },
              'hcp=2.5': { '1714': { k: '1.05' }, '1715': { k: '8.0' } },
              'hcp=-3.5': { '1714': { k: '6.1' }, '1715': { k: '1.12' } },
            },
          }),
        },
      }),
    );
    const sets = changes.flatMap((c) => (c.type === 'set' ? [c] : []));
    expect(sets.map((c) => c.key.toString())).toEqual([
      // sinners -1.5 = alliance +1.5
      'room:cs2:alliance~sinners:map-handicap-p1.5',
      // sinners +2.5 = alliance -2.5
      'room:cs2:alliance~sinners:map-handicap-m2.5',
    ]);
    expect(sets[0].line.props.odds).toEqual([1.7, 2.1]); // [alliance, sinners]
    expect(sets[0].line.props.ref).toMatchObject({
      m: '327',
      s: 'hcp=-1.5',
      o0: '1715',
      o1: '1714',
    });
  });

  it('polymarket: line là mức chấp của yes, quy về teams[0]; mức không hỗ trợ bị bỏ', async () => {
    const t = new PolymarketOddsTranslator(teams);
    const [c] = await t.translate(
      msg({
        tenant: 'polymarket',
        kind: 'polymarket.descriptor',
        payload: polyEvents(-1.5),
      }),
    );
    if (c?.type !== 'set') throw new Error('expected set');
    expect(c.key.toString()).toBe(
      'room:cs2:alliance~sinners:map-handicap-p1.5',
    );
    expect(c.line.props.ref).toMatchObject({ t0: 'tA', t1: 'tS' });

    const t2 = new PolymarketOddsTranslator(teams);
    expect(
      await t2.translate(
        msg({
          tenant: 'polymarket',
          kind: 'polymarket.descriptor',
          payload: polyEvents(-3.5),
        }),
      ),
    ).toEqual([]);
  });

  it('cùng kèo ở hai tenant → cùng room; khác mức → khác room', async () => {
    const s = new SptPubOddsTranslator(teams);
    const p = new PolymarketOddsTranslator(teams);
    const sKeys = (
      await s.translate(
        msg({
          ...spt(),
          payload: {
            version: 1,
            events: sptEvent({
              '327': {
                'hcp=-1.5': { '1714': { k: '2.1' }, '1715': { k: '1.7' } },
                'hcp=-2.5': { '1714': { k: '4.0' }, '1715': { k: '1.2' } },
              },
            }),
          },
        }),
      )
    ).map((c) => c.key.toString());
    const [pc] = await p.translate(
      msg({
        tenant: 'polymarket',
        kind: 'polymarket.descriptor',
        payload: polyEvents(-1.5),
      }),
    );
    expect(sKeys).toContain(pc?.key.toString());
    expect(sKeys).toContain('room:cs2:alliance~sinners:map-handicap-p2.5');
    expect(pc?.key.toString()).not.toBe(
      'room:cs2:alliance~sinners:map-handicap-p2.5',
    );
  });

  it('sptpub: gỡ đúng specifier, gỡ cả market, gỡ cả trận', async () => {
    const t = new SptPubOddsTranslator(teams);
    const priced = {
      '186': { '': { '4': { k: '1.5' }, '5': { k: '2.5' } } },
      '327': {
        'hcp=-1.5': { '1714': { k: '2.1' }, '1715': { k: '1.7' } },
        'hcp=1.5': { '1714': { k: '1.2' }, '1715': { k: '4.0' } },
      },
    };
    const removed = (cs: Awaited<ReturnType<typeof t.translate>>) =>
      cs.filter((c) => c.type === 'remove').map((c) => c.key.market);

    await t.translate(
      msg({ ...spt(), payload: { version: 1, events: sptEvent(priced) } }),
    );
    expect(
      removed(
        await t.translate(
          msg({
            ...spt(),
            payload: {
              version: 2,
              events: { H: { markets: { '327': { 'hcp=-1.5': null } } } },
            },
          }),
        ),
      ),
    ).toEqual(['map-handicap-p1.5']);
    expect(
      removed(
        await t.translate(
          msg({
            ...spt(),
            payload: {
              version: 3,
              events: { H: { markets: { '327': null } } },
            },
          }),
        ),
      ),
    ).toEqual(['map-handicap-m1.5']);

    await t.translate(
      msg({ ...spt(), payload: { version: 4, events: sptEvent(priced) } }),
    );
    expect(
      removed(
        await t.translate(
          msg({ ...spt(), payload: { version: 5, events: { H: null } } }),
        ),
      ).sort(),
    ).toEqual(['game-winner', 'map-handicap-m1.5', 'map-handicap-p1.5']);
  });
});

describe('total maps', () => {
  /** competitor1 = Sinners → c1 KHÔNG phải teams[0]; over/under vẫn không được đảo. */
  const sptEvent = (markets: Record<string, unknown>) => ({
    T: {
      desc: {
        scheduled: 1790326800,
        type: 'match',
        sport: '109',
        competitors: [
          { id: 'a', name: 'Sinners Esports' },
          { id: 'b', name: 'Alliance' },
        ],
      },
      markets,
    },
  });

  const moneyline = {
    conditionId: '0xm',
    slug: 'cs2-x',
    state: { closed: false, acceptingOrders: true },
    outcomes: {
      yes: { label: 'Sinners', tokenId: 'mS' },
      no: { label: 'Alliance', tokenId: 'mA' },
    },
    prices: { bestBid: '0.40', bestAsk: '0.50' },
    sports: { sportsMarketType: 'moneyline' },
  };
  const totals = (line: number) => ({
    conditionId: `0xt${line}`,
    slug: `cs2-x-total-games-${line}`,
    state: { closed: false, acceptingOrders: true },
    outcomes: {
      yes: { label: 'Over', tokenId: `over${line}` },
      no: { label: 'Under', tokenId: `under${line}` },
    },
    prices: { bestBid: '0.40', bestAsk: '0.50' },
    sports: { sportsMarketType: 'totals', line },
  });
  const polyEvent = (markets: unknown[]) => [
    {
      id: '1',
      slug: 'cs2-x',
      schedule: { startTime: '2026-09-25T09:00:00Z' },
      sports: { sport: { sport: 'cs2' } },
      markets,
    },
  ];
  const poly = (payload: unknown) =>
    msg({ tenant: 'polymarket', kind: 'polymarket.descriptor', payload });

  it('sptpub: total=x → total-maps-x, odds giữ [over, under]; mốc không hỗ trợ bị bỏ', async () => {
    const t = new SptPubOddsTranslator(teams);
    const changes = await t.translate(
      msg({
        channel: 'delta',
        payload: {
          version: 1,
          events: sptEvent({
            '328': {
              'total=2.5': { '12': { k: '2.2' }, '13': { k: '1.6' } },
              'total=5.5': { '12': { k: '9.0' }, '13': { k: '1.01' } },
            },
          }),
        },
      }),
    );
    expect(changes).toHaveLength(1);
    const [c] = changes;
    if (c?.type !== 'set') throw new Error('expected set');
    expect(c.key.toString()).toBe('room:cs2:alliance~sinners:total-maps-2.5');
    expect(c.line.props.odds).toEqual([2.2, 1.6]);
    expect(c.line.props.ref).toMatchObject({
      m: '328',
      s: 'total=2.5',
      o0: '12',
      o1: '13',
    });
  });

  it('polymarket: totals lấy cặp đội từ moneyline, token giữ [over, under]', async () => {
    const t = new PolymarketOddsTranslator(teams);
    const changes = await t.translate(
      poly(polyEvent([moneyline, totals(2.5), totals(5.5)])),
    );
    const c = changes.find((x) => x.key.market === 'total-maps-2.5');
    if (c?.type !== 'set') throw new Error('expected set');
    expect(c.key.toString()).toBe('room:cs2:alliance~sinners:total-maps-2.5');
    expect(c.line.props.ref).toMatchObject({ t0: 'over2.5', t1: 'under2.5' });
    expect(changes.map((x) => x.key.market).sort()).toEqual([
      'game-winner',
      'total-maps-2.5',
    ]);
  });

  it('polymarket: event không có moneyline → bỏ totals (không biết đội)', async () => {
    const t = new PolymarketOddsTranslator(teams);
    expect(await t.translate(poly(polyEvent([totals(2.5)])))).toEqual([]);
  });

  it('cùng mốc ở hai tenant → cùng room', async () => {
    const s = new SptPubOddsTranslator(teams);
    const p = new PolymarketOddsTranslator(teams);
    const [sc] = await s.translate(
      msg({
        channel: 'delta',
        payload: {
          version: 1,
          events: sptEvent({
            '328': { 'total=2.5': { '12': { k: '2.2' }, '13': { k: '1.6' } } },
          }),
        },
      }),
    );
    const pc = (
      await p.translate(poly(polyEvent([moneyline, totals(2.5)])))
    ).find((x) => x.key.market === 'total-maps-2.5');
    expect(sc?.key.toString()).toBe(pc?.key.toString());
  });
});

describe('map winner', () => {
  /** competitor1 = Sinners → c1 KHÔNG phải teams[0]. */
  const sptEvent = (markets: Record<string, unknown>) => ({
    W: {
      desc: {
        scheduled: 1790326800,
        type: 'match',
        sport: '109',
        competitors: [
          { id: 'a', name: 'Sinners Esports' },
          { id: 'b', name: 'Alliance' },
        ],
      },
      markets,
    },
  });
  const child = (title: string | null, slug: string) => ({
    conditionId: `0x${slug}`,
    slug,
    groupItemTitle: title,
    state: { closed: false, acceptingOrders: true },
    outcomes: {
      yes: { label: 'Sinners', tokenId: `${slug}-S` },
      no: { label: 'Alliance', tokenId: `${slug}-A` },
    },
    prices: { bestBid: '0.40', bestAsk: '0.50' },
    sports: { sportsMarketType: 'child_moneyline' },
  });
  const poly = (sport: string, markets: unknown[]) =>
    msg({
      tenant: 'polymarket',
      kind: 'polymarket.descriptor',
      payload: [
        {
          id: '1',
          slug: 'x',
          schedule: { startTime: '2026-09-25T09:00:00Z' },
          sports: { sport: { sport } },
          markets,
        },
      ],
    });

  it('sptpub: mapnr=n → map-n-winner, odds đảo theo thứ tự đội; map không hỗ trợ bị bỏ', async () => {
    const t = new SptPubOddsTranslator(teams);
    const changes = await t.translate(
      msg({
        channel: 'delta',
        payload: {
          version: 1,
          events: sptEvent({
            '330': {
              'mapnr=1': { '4': { k: '1.27' }, '5': { k: '3.45' } },
              'mapnr=6': { '4': { k: '1.5' }, '5': { k: '2.5' } },
            },
          }),
        },
      }),
    );
    expect(changes).toHaveLength(1);
    const [c] = changes;
    if (c?.type !== 'set') throw new Error('expected set');
    expect(c.key.toString()).toBe('room:cs2:alliance~sinners:map-1-winner');
    expect(c.line.props.odds).toEqual([3.45, 1.27]); // [alliance, sinners]
    expect(c.line.props.ref).toMatchObject({ s: 'mapnr=1', o0: '5', o1: '4' });
  });

  it('polymarket: số map lấy từ "Map n Winner" / "Game n Winner", dự phòng slug', async () => {
    const t = new PolymarketOddsTranslator(teams);
    const cs2 = await t.translate(
      poly('cs2', [
        child('Map 1 Winner', 'cs2-x-game1'),
        child(null, 'cs2-x-game2'),
        child('Something else', 'cs2-x-other'),
      ]),
    );
    expect(cs2.map((c) => c.key.toString())).toEqual([
      'room:cs2:alliance~sinners:map-1-winner',
      'room:cs2:alliance~sinners:map-2-winner',
    ]);
    const [c] = cs2;
    expect(c?.type === 'set' && c.line.props.ref).toMatchObject({
      t0: 'cs2-x-game1-A',
      t1: 'cs2-x-game1-S',
    });

    const lol = await t.translate(
      poly('lol', [child('Game 3 Winner', 'lol-x-game3')]),
    );
    expect(lol.map((c) => c.key.toString())).toEqual([
      'room:lol:alliance~sinners:map-3-winner',
    ]);
  });

  it('cùng map ở hai tenant → cùng room; khác map → khác room', async () => {
    const s = new SptPubOddsTranslator(teams);
    const p = new PolymarketOddsTranslator(teams);
    const sKeys = (
      await s.translate(
        msg({
          channel: 'delta',
          payload: {
            version: 1,
            events: sptEvent({
              '330': {
                'mapnr=1': { '4': { k: '1.27' }, '5': { k: '3.45' } },
                'mapnr=2': { '4': { k: '1.3' }, '5': { k: '3.2' } },
              },
            }),
          },
        }),
      )
    ).map((c) => c.key.toString());
    const [pc] = await p.translate(
      poly('cs2', [child('Map 2 Winner', 'cs2-x-game2')]),
    );
    expect(sKeys).toContain(pc?.key.toString());
    expect(pc?.key.market).toBe('map-2-winner');
  });
  it('Dota 2 và Valorant: hai tenant ghép cùng room (polymarket dota2/val ↔ sptpub 111/194)', async () => {
    const cases = [
      { poly: 'dota2', spt: '111', sport: 'dota2', title: 'Game 1 Winner' },
      { poly: 'val', spt: '194', sport: 'valorant', title: 'Map 1 Winner' },
    ];
    for (const c of cases) {
      const s = new SptPubOddsTranslator(teams);
      const p = new PolymarketOddsTranslator(teams);
      const sKeys = (
        await s.translate(
          msg({
            channel: 'delta',
            payload: {
              version: 1,
              events: {
                W: {
                  desc: {
                    scheduled: 1790326800,
                    type: 'match',
                    sport: c.spt,
                    competitors: [
                      { id: 'a', name: 'Sinners Esports' },
                      { id: 'b', name: 'Alliance' },
                    ],
                  },
                  markets: {
                    '330': {
                      'mapnr=1': { '4': { k: '1.27' }, '5': { k: '3.45' } },
                    },
                  },
                },
              },
            },
          }),
        )
      ).map((x) => x.key.toString());
      const [pc] = await p.translate(
        poly(c.poly, [child(c.title, `${c.poly}-x-game1`)]),
      );
      expect(sKeys).toEqual([`room:${c.sport}:alliance~sinners:map-1-winner`]);
      expect(pc?.key.toString()).toBe(sKeys[0]);
    }
  });
});

describe('polymarket: đối chiếu theo vòng quét', () => {
  const ev = (id: string) => ({
    id,
    slug: `cs2-${id}`,
    schedule: { startTime: '2026-09-25T09:00:00Z' },
    sports: { sport: { sport: 'cs2' } },
    markets: [
      {
        conditionId: `0x${id}`,
        slug: `cs2-${id}`,
        state: { closed: false, acceptingOrders: true },
        outcomes: {
          yes: { label: `${id}a`, tokenId: `${id}-a` },
          no: { label: `${id}b`, tokenId: `${id}-b` },
        },
        prices: { bestBid: '0.40', bestAsk: '0.50' },
        sports: { sportsMarketType: 'moneyline' },
      },
    ],
  });
  const m = (channel: string, payload: unknown) =>
    msg({
      taskId: 'poly-events',
      tenant: 'polymarket',
      kind: 'polymarket.descriptor',
      channel,
      payload,
    });
  /** Một vòng quét đầy đủ với các event cho trước; trả về thay đổi của mốc cuối vòng. */
  const cycle = async (
    t: PolymarketOddsTranslator,
    ids: string[],
    pages = 1,
  ) => {
    await t.translate(m('cycle-start', { cycle: 1 }));
    if (ids.length) await t.translate(m('events', ids.map(ev)));
    return t.translate(m('cycle-complete', { cycle: 1, pages }));
  };

  it('vắng 2 vòng liên tiếp mới gỡ (missing_from_listing); mốc vòng không bị đếm là parse_failed', async () => {
    const reports: unknown[] = [];
    const skips: string[] = [];
    const t = new PolymarketOddsTranslator(
      teams,
      undefined,
      (_k, r) => skips.push(r),
      (r) => reports.push(r),
    );
    await cycle(t, ['x', 'y']);
    expect(await cycle(t, ['x'])).toEqual([]); // y vắng lần 1 → chờ
    const removed = await cycle(t, ['x']); // y vắng lần 2 → gỡ
    expect(removed).toEqual([
      expect.objectContaining({
        type: 'remove',
        tenant: 'polymarket',
        reason: 'missing_from_listing',
      }),
    ]);
    expect(removed[0]?.key.toString()).toBe('room:cs2:ya~yb:game-winner');
    expect(reports.at(-2)).toMatchObject({ known: 2, pending: 1, removed: 0 });
    expect(reports.at(-1)).toMatchObject({
      known: 2,
      removed: 1,
      massive: false,
    });
    expect(skips).not.toContain('parse_failed');
  });

  it('không có cycle-start hoặc 0 trang → không đối chiếu', async () => {
    const t = new PolymarketOddsTranslator(teams);
    await cycle(t, ['x']);
    await t.translate(m('cycle-complete', { cycle: 2, pages: 3 })); // thiếu cycle-start
    await t.translate(m('cycle-complete', { cycle: 3, pages: 3 }));
    expect(await cycle(t, [], 0)).toEqual([]);
    expect(await cycle(t, [], 0)).toEqual([]);
    // x vẫn còn: một vòng hợp lệ có x → không gỡ gì
    expect(await cycle(t, ['x'])).toEqual([]);
  });

  it('gỡ hàng loạt bất thường → giữ lại tối đa maxHeldCycles vòng rồi mới gỡ', async () => {
    const reports: { held: number; removed: number; massive: boolean }[] = [];
    const t = new PolymarketOddsTranslator(
      teams,
      undefined,
      undefined,
      (r) => reports.push(r),
      {
        missingCycles: 2,
        massiveRatio: 0.3,
        massiveMinKnown: 2,
        maxHeldCycles: 1,
      },
    );
    await cycle(t, ['p', 'q', 'r']);
    await cycle(t, ['z']); // cả ba vắng lần 1 (z là market mới)
    expect(await cycle(t, ['z'])).toEqual([]); // vắng lần 2: 3/4 = 75% → giữ lại
    expect(reports.at(-1)).toMatchObject({
      held: 3,
      removed: 0,
      massive: true,
    });
    const removed = await cycle(t, ['z']); // hết thời gian giữ → gỡ
    expect(removed).toHaveLength(3);
    expect(reports.at(-1)).toMatchObject({
      held: 0,
      removed: 3,
      massive: true,
    });
  });
});
