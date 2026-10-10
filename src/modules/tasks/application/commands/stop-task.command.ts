import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { TaskRecord } from '../../domain/task-record.js';
import type { TaskSupervisor } from '../task-supervisor.js';

export interface StopTaskCommand {
  readonly taskId: string;
  /** Ai yêu cầu dừng (id principal) — ghi vào log. */
  readonly requestedBy?: string;
}

export class StopTaskHandler implements CommandHandler<
  StopTaskCommand,
  OperationStatus<TaskRecord>
> {
  constructor(private readonly _supervisor: TaskSupervisor) {}

  execute({ taskId, requestedBy }: StopTaskCommand) {
    return this._supervisor.stop(
      taskId,
      `stop requested by ${requestedBy ?? 'unknown'}`,
    );
  }
}
