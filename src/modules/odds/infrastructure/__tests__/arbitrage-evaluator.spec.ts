import { ArbitrageEvaluator } from '../../application/arbitrage-evaluator.js';
import { MatchKey } from '../../domain/match-key.js';
import { OddsLine } from '../../domain/odds-line.js';
import { InMemoryOddsRoomStore } from '../persistence/in-memory/in-memory-odds-room.store.js';
import { InMemorySignalStateStore } from '../persistence/in-memory/in-memory-signal-state.store.js';
import { InMemoryArbitrageSettingsStore } from '../settings/in-memory-arbitrage-settings.store.js';
import type { DomainEvent } from '../../../../shared/domain/domain-event.js';

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
    now += 30_000;
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
});
