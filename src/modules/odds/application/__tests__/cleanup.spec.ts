import { InMemoryOddsRoomStore } from '../../infrastructure/persistence/in-memory/in-memory-odds-room.store.js';
import { InMemoryOpsEventBus } from '../../../../shared/infrastructure/ops/in-memory-ops-event-bus.js';
import type { OpsEvent } from '../../../../shared/application/ops-event-bus.js';
import { ResetOddsRoomsHandler } from '../commands/reset-odds-rooms.command.js';
import { ExpireFinishedMatchesHandler } from '../commands/expire-finished-matches.command.js';
import type { LaneDispatcher } from '../lane-dispatcher.js';
import type { OddsLineChange } from '../raw-odds.translator.js';
import { MatchKey } from '../../domain/match-key.js';
import { OddsLine } from '../../domain/odds-line.js';

const key = (a: string, b: string) =>
  MatchKey.of({ sport: 'cs2', teamX: a, teamY: b, market: 'game-winner' });
const line = (tenant: string, startsAt: number) =>
  OddsLine.create({
    tenant,
    odds: [2, 2],
    status: 'open',
    phase: 'live',
    updatedAt: 1,
    startsAt,
    ref: {},
  });

describe('ResetOddsRoomsHandler', () => {
  it('xóa sạch room và báo số room/dòng', async () => {
    const rooms = new InMemoryOddsRoomStore();
    await rooms.setLine(key('a', 'b'), line('sptpub', 0));
    await rooms.setLine(key('a', 'b'), line('polymarket', 0));
    await rooms.setLine(key('c', 'd'), line('sptpub', 0));
    const bus = new InMemoryOpsEventBus();
    const seen: OpsEvent[] = [];
    bus.subscribe((e) => seen.push(e));

    const r = await new ResetOddsRoomsHandler(rooms, bus, () => 7).execute({
      reason: 'reset_on_start',
    });
    expect(r).toEqual({ rooms: 2, lines: 3 });
    expect(await rooms.list()).toEqual([]);
    expect(seen).toEqual([
      {
        type: 'odds.reset',
        topic: 'odds',
        at: 7,
        data: { rooms: 2, lines: 3, reason: 'reset_on_start' },
      },
    ]);
  });
});

describe('ExpireFinishedMatchesHandler', () => {
  it('chỉ gỡ dòng có startsAt + thời lượng tối đa đã qua, lý do match_expired', async () => {
    const rooms = new InMemoryOddsRoomStore();
    const H = 3_600_000;
    await rooms.setLine(key('a', 'b'), line('sptpub', 0)); // trận lúc 0
    await rooms.setLine(key('a', 'b'), line('polymarket', 5 * H)); // bên kia báo giờ khác
    await rooms.setLine(key('c', 'd'), line('sptpub', 9 * H));
    const submitted: OddsLineChange[] = [];
    const lanes = {
      submit: (c: OddsLineChange[]) => {
        submitted.push(...c);
        return Promise.resolve();
      },
    } as unknown as LaneDispatcher;

    const n = await new ExpireFinishedMatchesHandler(
      rooms,
      lanes,
      () => 10 * H,
    ).execute({ maxMatchDurationMs: 8 * H });
    expect(n).toBe(1);
    expect(submitted).toEqual([
      expect.objectContaining({
        type: 'remove',
        tenant: 'sptpub',
        reason: 'match_expired',
      }),
    ]);
    expect(submitted[0]?.key.toString()).toBe('room:cs2:a~b:game-winner');
  });
});
