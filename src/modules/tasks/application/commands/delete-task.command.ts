import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { TaskRecord } from '../../domain/task-record.js';
import type { TaskSupervisor } from '../task-supervisor.js';
import type { TaskSpecStore } from '../task-spec.store.js';

export interface DeleteTaskCommand {
  readonly taskId: string;
}

/** Xóa hồ sơ một task đã dừng (cả bản lưu bền); trả về bản ghi vừa xóa. */
export class DeleteTaskHandler implements CommandHandler<
  DeleteTaskCommand,
  OperationStatus<TaskRecord>
> {
  constructor(
    private readonly _supervisor: TaskSupervisor,
    private readonly _store: TaskSpecStore,
  ) {}

  async execute({ taskId }: DeleteTaskCommand) {
    const r = await this._supervisor.remove(taskId);
    if (r.status === 'SUCEED') await this._store.delete(taskId);
    return r;
  }
}
