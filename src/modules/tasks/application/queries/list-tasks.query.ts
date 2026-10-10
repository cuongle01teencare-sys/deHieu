import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { TaskRecord } from '../../domain/task-record.js';
import type { TaskRegistry } from '../task-registry.js';

export interface ListTasksQuery {
  readonly tenant?: string;
}

export class ListTasksHandler implements QueryHandler<
  ListTasksQuery,
  TaskRecord[]
> {
  constructor(private readonly _registry: TaskRegistry) {}

  async execute({ tenant }: ListTasksQuery) {
    const all = await this._registry.list();
    return tenant ? all.filter((r) => r.spec.tenant === tenant) : all;
  }
}
