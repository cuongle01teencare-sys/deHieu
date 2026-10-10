import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { TaskRecord } from '../../domain/task-record.js';
import type { TaskSupervisor } from '../task-supervisor.js';

export interface DeleteTaskCommand {
  readonly taskId: string;
}

/** Xóa hồ sơ một task đã dừng; trả về bản ghi vừa xóa. */
export class DeleteTaskHandler implements CommandHandler<
  DeleteTaskCommand,
  OperationStatus<TaskRecord>
> {
  constructor(private readonly _supervisor: TaskSupervisor) {}

  execute({ taskId }: DeleteTaskCommand) {
    return this._supervisor.remove(taskId);
  }
}
