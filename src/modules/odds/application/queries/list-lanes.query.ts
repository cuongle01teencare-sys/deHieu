import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { LaneDispatcher, LaneStats } from '../lane-dispatcher.js';

export type ListLanesQuery = Record<string, never>;

export class ListLanesHandler implements QueryHandler<
  ListLanesQuery,
  LaneStats[]
> {
  constructor(private readonly _lanes: LaneDispatcher) {}

  execute() {
    return Promise.resolve(this._lanes.stats());
  }
}
