import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type {
  ArbitrageEvaluator,
  EvaluatorStats,
} from '../arbitrage-evaluator.js';
import type { SignalStateStore } from '../signal-state.store.js';
import type { ListRoomsHandler, RoomsOverview } from './list-rooms.query.js';

export type GetArbitrageStatsQuery = Record<string, never>;

export interface ArbitrageStats {
  readonly rooms: RoomsOverview;
  readonly evaluator: EvaluatorStats;
  readonly activeSignals: number;
}

/** Một màn hình để biết: có bao nhiêu room, evaluator đã chạy bao nhiêu, đang có bao nhiêu kèo. */
export class GetArbitrageStatsHandler implements QueryHandler<
  GetArbitrageStatsQuery,
  ArbitrageStats
> {
  constructor(
    private readonly _rooms: ListRoomsHandler,
    private readonly _evaluator: ArbitrageEvaluator,
    private readonly _signals: SignalStateStore,
  ) {}

  async execute(): Promise<ArbitrageStats> {
    const [overview, active] = await Promise.all([
      this._rooms.overview(),
      this._signals.activeSignals(),
    ]);
    return {
      rooms: overview,
      evaluator: this._evaluator.stats(),
      activeSignals: active.length,
    };
  }
}
