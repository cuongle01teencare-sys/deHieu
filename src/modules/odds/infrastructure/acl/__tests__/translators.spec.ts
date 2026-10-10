import type { TaskDataMessage } from '../../../../tasks/application/task-protocol.js';
import { TeamNameResolver } from '../../../application/team-name.resolver.js';
import type { TeamAliasRepository } from '../../../domain/team-alias.repository.js';
import { SptPubOddsTranslator } from '../sptpub/sptpub-odds.translator.js';
import { PolymarketOddsTranslator } from '../polymarket/polymarket-odds.translator.js';

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
