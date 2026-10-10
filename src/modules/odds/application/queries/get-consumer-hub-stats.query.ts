import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { ConsumerControl, ConsumerHubStats } from '../consumer-control.js';

export type GetConsumerHubStatsQuery = Record<string, never>;

export class GetConsumerHubStatsHandler implements QueryHandler<
  GetConsumerHubStatsQuery,
  ConsumerHubStats
> {
  constructor(private readonly _consumers: ConsumerControl) {}

  execute() {
    return Promise.resolve(this._consumers.stats());
  }
}
