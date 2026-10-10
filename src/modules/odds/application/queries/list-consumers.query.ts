import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { ConsumerControl, ConsumerView } from '../consumer-control.js';

export type ListConsumersQuery = Record<string, never>;

export class ListConsumersHandler implements QueryHandler<
  ListConsumersQuery,
  ConsumerView[]
> {
  constructor(private readonly _consumers: ConsumerControl) {}

  execute() {
    return Promise.resolve(this._consumers.list());
  }
}
