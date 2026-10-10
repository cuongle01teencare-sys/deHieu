import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { TaskRecord } from '../../domain/task-record.js';
import type { TaskRuntimeTarget } from '../../domain/task-spec.js';
import { isActive } from '../../domain/task-state.js';
import type { TaskSupervisor } from '../task-supervisor.js';
import type { TaskKindRegistry } from '../task-kind.registry.js';

/** Không có tenant: app tự suy ra từ kind. */
export interface StartTaskCommand {
  readonly taskId: string;
  readonly kind: string;
  readonly params: Record<string, unknown>;
  readonly runtime: TaskRuntimeTarget;
}

export class StartTaskHandler implements CommandHandler<
  StartTaskCommand,
  OperationStatus<TaskRecord>
> {
  constructor(
    private readonly _supervisor: TaskSupervisor,
    private readonly _kinds: TaskKindRegistry,
  ) {}

  async execute(cmd: StartTaskCommand): Promise<OperationStatus<TaskRecord>> {
    const info = this._kinds.find(cmd.kind);
    if (!info)
      return {
        status: 'FAILED',
        reason: `UNKNOWN_KIND: ${cmd.kind} (có: ${this._kinds
          .list()
          .map((k) => k.kind)
          .join(', ')})`,
      };
    const running = (await this._supervisor.list()).find(
      (r) =>
        r.spec.kind === cmd.kind &&
        r.spec.taskId !== cmd.taskId &&
        isActive(r.state),
    );
    if (running)
      return {
        status: 'FAILED',
        reason: `KIND_ALREADY_RUNNING: ${cmd.kind} đang chạy ở task ${running.spec.taskId}`,
      };
    return this._supervisor.start({ ...cmd, tenant: info.tenant });
  }
}
