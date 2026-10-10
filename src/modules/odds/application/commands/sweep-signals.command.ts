import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import { MatchKey } from '../../domain/match-key.js';
import type { SignalStateStore } from '../signal-state.store.js';
import type { ArbitrageEvaluator } from '../arbitrage-evaluator.js';

export type SweepSignalsCommand = Record<string, never>;

/** Chạy định kỳ: đánh giá lại các room đang có kèo để phát lại kèo đã quá 30s. */
export class SweepSignalsHandler implements CommandHandler<SweepSignalsCommand> {
  constructor(
    private readonly _signals: SignalStateStore,
    private readonly _evaluator: ArbitrageEvaluator,
  ) {}

  async execute(): Promise<void> {
    for (const room of await this._signals.roomsWithActiveSignals()) {
      const key = MatchKey.parse(room);
      if (key) await this._evaluator.evaluate(key);
    }
  }
}
