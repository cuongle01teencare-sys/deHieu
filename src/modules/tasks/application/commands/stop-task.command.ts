import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { TaskRecord } from '../../domain/task-record.js';
import type { TaskSupervisor } from '../task-supervisor.js';
import type { TaskSpecStore } from '../task-spec.store.js';

export interface StopTaskCommand {
  readonly taskId: string;
  /** Ai yêu cầu dừng (id principal) — ghi vào log. */
  readonly requestedBy?: string;
}

/** Dừng task. Task lưu bền vẫn được giữ, nhưng lần khởi động sau KHÔNG tự chạy lại. */
export class StopTaskHandler implements CommandHandler<
  StopTaskCommand,
  OperationStatus<TaskRecord>
> {
  constructor(
    private readonly _supervisor: TaskSupervisor,
    private readonly _store: TaskSpecStore,
  ) {}

  async execute({ taskId, requestedBy }: StopTaskCommand) {
    const r = await this._supervisor.stop(
      taskId,
      `stop requested by ${requestedBy ?? 'unknown'}`,
    );
    if (r.status === 'SUCEED' && r.data.spec.persist)
      await this._store.setDesired(taskId, 'stopped');
    return r;
  }
}
