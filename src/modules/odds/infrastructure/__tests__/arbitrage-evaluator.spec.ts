import { ArbitrageEvaluator } from '../../application/arbitrage-evaluator.js';
import { DEFAULT_ARBITRAGE_SETTINGS } from '../../application/arbitrage-settings.js';
import { MatchKey } from '../../domain/match-key.js';
import { OddsLine } from '../../domain/odds-line.js';
import { InMemoryOddsRoomStore } from '../persistence/in-memory/in-memory-odds-room.store.js';
import { InMemorySignalStateStore } from '../persistence/in-memory/in-memory-signal-state.store.js';
import { InMemoryArbitrageSettingsStore } from '../settings/in-memory-arbitrage-settings.store.js';
import type { DomainEvent } from '../../../../shared/domain/domain-event.js';
import { ArbitrageSignalCancelled } from '../../domain/events/arbitrage-signal.events.js';

describe('ArbitrageEvaluator: moc margin cua lan phat moi', () => {
  it('refresh khong doi moc; giam tich luy du buoc thi huy va phat moi', async () => {
    const rooms = new InMemoryOddsRoomStore();
    const signals = new InMemorySignalStateStore();
    const events: DomainEvent[] = [];
    let now = 1_000;
    const evaluator = new ArbitrageEvaluator(
      rooms,
      signals,
      new InMemoryArbitrageSettingsStore(),
      {
        publish: (batch) => {
          events.push(...batch);
          return Promise.resolve();
        },
      },
      () => now,
    );
    const key = MatchKey.of({
      sport: 'cs2',
      teamX: 'a',
      teamY: 'b',
      market: 'game-winner',
    });
    const evaluateMargin = async (margin: number) => {
      const odds = 2 * (1 + margin);
      for (const [tenant, prices] of [
        ['a', [odds, 1.01]],
        ['b', [1.01, odds]],
      ] as const) {
        await rooms.setLine(
          key,
          OddsLine.create({
            tenant,
            odds: prices,
            status: 'open',
            phase: 'prematch',
            startsAt: 0,
            updatedAt: now,
            ref: {},
          }),
        );
      }
      await evaluator.evaluate(key);
    };

    await evaluateMargin(0.09);
    const [first] = await signals.activeSignals();
    now += DEFAULT_ARBITRAGE_SETTINGS.signalTtlMs;
    await evaluateMargin(0.085);
    const [refreshed] = await signals.activeSignals();
    expect(refreshed.signalId).toBe(first.signalId);
    expect(refreshed.margin).toBeCloseTo(0.085, 12);
    expect(
      (await signals.getCombos(key.toString())).get(first.comboId)
        ?.issuedMargin,
    ).toBeCloseTo(0.09, 12);

    now += 1_000;
    await evaluateMargin(0.08);
    const active = await signals.activeSignals();
    expect(active).toHaveLength(1);
    expect(active[0].signalId).not.toBe(first.signalId);
    expect(active[0].margin).toBeCloseTo(0.08, 12);
    expect(events.map((e) => ('name' in e ? e.name : null))).toEqual([
      'arbitrage.signal.issued',
      'arbitrage.signal.refreshed',
      'arbitrage.signal.cancelled',
      'arbitrage.signal.issued',
    ]);
    expect(events[2]).toMatchObject({
      signalId: first.signalId,
      reason: 'margin_decreased',
    });
    expect(
      (await signals.getCombos(key.toString())).get(first.comboId)
        ?.issuedMargin,
    ).toBeCloseTo(0.08, 12);
  });

  it('giờ bắt đầu bị dời quá ngưỡng → hủy start_time_mismatch kèm giờ từng chân và độ lệch', async () => {
    const rooms = new InMemoryOddsRoomStore();
    const signals = new InMemorySignalStateStore();
    const events: DomainEvent[] = [];
    const evaluator = new ArbitrageEvaluator(
      rooms,
      signals,
      new InMemoryArbitrageSettingsStore(),
      {
        publish: (batch) => {
          events.push(...batch);
          return Promise.resolve();
        },
      },
      () => 1_000,
    );
    const key = MatchKey.of({
      sport: 'cs2',
      teamX: 'a',
      teamY: 'b',
      market: 'game-winner',
    });
    const T = 10 * 3_600_000;
    const line = (tenant: string, odds: [number, number], startsAt: number) =>
      rooms.setLine(
        key,
        OddsLine.create({
          tenant,
          odds,
          status: 'open',
          phase: 'prematch',
          startsAt,
          updatedAt: 1_000,
          ref: {},
        }),
      );
    await line('a', [2.2, 1.01], T);
    await line('b', [1.01, 2.2], T);
    await evaluator.evaluate(key);
    const [issued] = await signals.activeSignals();
    expect(issued.legs.map((l) => l.startsAt)).toEqual([T, T]);

    await line('a', [2.2, 1.01], T + 45 * 60_000); // a dời 45 phút
    await evaluator.evaluate(key);
    const cancel = events.find(
      (e) =>
        e instanceof ArbitrageSignalCancelled && e.signalId === issued.signalId,
    );
    expect(cancel).toMatchObject({
      reason: 'start_time_mismatch',
      detail: {
        startTimes: [
          { tenant: 'a', startsAt: T + 45 * 60_000 },
          { tenant: 'b', startsAt: T },
        ],
        startDriftMs: 45 * 60_000,
        maxStartDriftMs: 20 * 60_000,
      },
    });
  });
});
