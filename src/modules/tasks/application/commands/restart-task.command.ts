import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { TaskRecord } from '../../domain/task-record.js';
import type { TaskSupervisor } from '../task-supervisor.js';
import type { StartTaskHandler } from './start-task.command.js';

export interface RestartTaskCommand {
  readonly taskId: string;
}

/**
 * Chạy lại task đã dừng/lỗi với đúng spec cũ (kind, params, runtime, persist).
 * Không xóa hồ sơ nên task lưu bền không mất cờ persist.
 */
export class RestartTaskHandler implements CommandHandler<
  RestartTaskCommand,
  OperationStatus<TaskRecord>
> {
  constructor(
    private readonly _supervisor: TaskSupervisor,
    private readonly _start: StartTaskHandler,
  ) {}

  async execute({ taskId }: RestartTaskCommand) {
    const record = await this._supervisor.get(taskId);
    if (!record) return { status: 'NOT_FOUND' as const };
    const { kind, params, runtime, persist } = record.spec;
    return this._start.execute({ taskId, kind, params, runtime, persist });
  }
}
