import { describe, expect, it } from 'vitest';
import { ArbitrageEvaluator } from '../../application/arbitrage-evaluator.js';
import { GetArbitrageStatsHandler } from '../../application/queries/get-arbitrage-stats.query.js';
import { ListRoomsHandler } from '../../application/queries/list-rooms.query.js';
import { GetRoomHandler } from '../../application/queries/get-room.query.js';
import { MatchKey } from '../../domain/match-key.js';
import { OddsLine } from '../../domain/odds-line.js';
import { InMemoryEventPublisher } from '../messaging/in-memory.event-publisher.js';
import { InMemoryOddsRoomStore } from '../persistence/in-memory/in-memory-odds-room.store.js';
import { InMemorySignalStateStore } from '../persistence/in-memory/in-memory-signal-state.store.js';
import { InMemoryArbitrageSettingsStore } from '../settings/in-memory-arbitrage-settings.store.js';

const NOW = 1_800_000_000_000;
const key = (x: string, y: string) =>
  MatchKey.of({ sport: 'cs2', teamX: x, teamY: y, market: 'game-winner' });
const line = (tenant: string, odds: [number, number], ageMs = 0) =>
  OddsLine.create({
    tenant,
    odds,
    status: 'open',
    phase: 'live',
    updatedAt: NOW - ageMs,
    startsAt: NOW,
    ref: {},
  });

const setup = async () => {
  const rooms = new InMemoryOddsRoomStore();
  const settings = new InMemoryArbitrageSettingsStore();
  const signals = new InMemorySignalStateStore();
  const arb = key('alpha', 'beta');
  const solo = key('gamma', 'delta');
  await rooms.setLine(arb, line('sptpub', [2.2, 1.7]));
  await rooms.setLine(arb, line('polymarket', [1.6, 2.2], 3_000));
  await rooms.setLine(solo, line('sptpub', [1.5, 2.5]));
  const list = new ListRoomsHandler(rooms, settings, () => NOW);
  const evaluator = new ArbitrageEvaluator(
    rooms,
    signals,
    settings,
    new InMemoryEventPublisher(),
    () => NOW,
  );
  return { list, evaluator, signals, arb, rooms, settings };
};

describe('ListRoomsHandler', () => {
  it('liệt kê room (id + đội + tenant), room có arbitrage lên đầu', async () => {
    const { list } = await setup();
    const r = await list.execute({ limit: 50, offset: 0 });
    expect(r.total).toBe(2);
    expect(r.items[0]).toMatchObject({
      room: 'room:cs2:alpha~beta:game-winner',
      tenants: ['polymarket', 'sptpub'],
      aboveMinMargin: true,
    });
    expect(r.items[0]?.bestMargin).toBeCloseTo(0.1, 5);
    expect(r.items[1]?.bestMargin).toBeNull();
  });

  it('lọc theo tenant, matched và tên đội', async () => {
    const { list } = await setup();
    const page = { limit: 50, offset: 0 };
    expect((await list.execute({ ...page, tenant: 'polymarket' })).total).toBe(
      1,
    );
    const solo = await list.execute({ ...page, matched: false });
    expect(solo.items.map((i) => i.room)).toEqual([
      'room:cs2:delta~gamma:game-winner',
    ]);
    expect((await list.execute({ ...page, q: 'GAM' })).total).toBe(1);
  });

  it('overview đếm room, room đã ghép, room đạt ngưỡng và theo tenant', async () => {
    const { list } = await setup();
    const o = await list.overview();
    expect(o).toMatchObject({
      total: 2,
      matched: 1,
      withCombos: 1,
      aboveMinMargin: 1,
    });
    expect(o.byTenant.sptpub).toMatchObject({ lines: 2, open: 2 });
    expect(o.byTenant.polymarket?.newestAgeMs).toBe(3_000);
  });
});

describe('GetRoomHandler', () => {
  it('chi tiết: odds từng tenant, tổ hợp + margin, kèo đang hiệu lực', async () => {
    const { evaluator, signals, arb, rooms, settings } = await setup();
    await evaluator.evaluate(arb);
    const get = new GetRoomHandler(rooms, settings, signals, () => NOW);
    const d = await get.execute({ room: arb.toString() });
    expect(d?.lines.polymarket).toMatchObject({
      odds: [1.6, 2.2],
      ageMs: 3_000,
    });
    expect(d?.combos[0]).toMatchObject({
      comboId: 'sptpub>0|polymarket>1',
      aboveMinMargin: true,
    });
    expect(d?.activeSignals).toHaveLength(1);
    expect(await get.execute({ room: 'room:cs2:x~y:game-winner' })).toBeNull();
    expect(await get.execute({ room: 'rác' })).toBeNull();
  });
});

describe('GetArbitrageStatsHandler', () => {
  it('đếm lượt đánh giá và kèo đã phát', async () => {
    const { list, evaluator, signals, arb } = await setup();
    await evaluator.evaluate(arb);
    await evaluator.evaluate(arb); // không đổi → không phát thêm
    const stats = await new GetArbitrageStatsHandler(
      list,
      evaluator,
      signals,
    ).execute();
    expect(stats.evaluator).toMatchObject({
      evaluations: 2,
      roomsEvaluated: 1,
      issued: 1,
      cancelled: 0,
      errors: 0,
    });
    expect(stats.activeSignals).toBe(1);
    expect(stats.rooms.total).toBe(2);
  });
});
