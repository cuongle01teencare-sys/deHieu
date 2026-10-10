import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { ArbitrageSignal } from '../../domain/arbitrage-signal.js';
import type { SignalStateStore } from '../signal-state.store.js';

export type ListActiveSignalsQuery = Record<string, never>;

export class ListActiveSignalsHandler implements QueryHandler<
  ListActiveSignalsQuery,
  ArbitrageSignal[]
> {
  constructor(private readonly _signals: SignalStateStore) {}

  execute() {
    return this._signals.activeSignals();
  }
}
