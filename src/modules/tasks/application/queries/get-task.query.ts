import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { TaskRecord } from '../../domain/task-record.js';
import type { TaskRegistry } from '../task-registry.js';

export interface GetTaskQuery {
  readonly taskId: string;
}

export class GetTaskHandler implements QueryHandler<
  GetTaskQuery,
  TaskRecord | null
> {
  constructor(private readonly _registry: TaskRegistry) {}

  execute({ taskId }: GetTaskQuery) {
    return this._registry.get(taskId);
  }
}
