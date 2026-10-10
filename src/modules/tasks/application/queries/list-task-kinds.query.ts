import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { TaskKindInfo, TaskKindRegistry } from '../task-kind.registry.js';

export type ListTaskKindsQuery = Record<string, never>;

export class ListTaskKindsHandler implements QueryHandler<
  ListTaskKindsQuery,
  TaskKindInfo[]
> {
  constructor(private readonly _kinds: TaskKindRegistry) {}

  execute() {
    return Promise.resolve(this._kinds.list());
  }
}
