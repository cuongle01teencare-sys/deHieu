import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { TaskRecord } from '../../domain/task-record.js';
import type { TaskRuntimeTarget, TaskSpec } from '../../domain/task-spec.js';
import { isActive } from '../../domain/task-state.js';
import type { TaskSupervisor } from '../task-supervisor.js';
import type { TaskKindRegistry } from '../task-kind.registry.js';
import type { TaskSpecStore } from '../task-spec.store.js';

/** Không có tenant: app tự suy ra từ kind. */
export interface StartTaskCommand {
  readonly taskId: string;
  readonly kind: string;
  readonly params: Record<string, unknown>;
  readonly runtime: TaskRuntimeTarget;
  /**
   * true = lưu bền (tự chạy lại khi app khởi động). Bỏ trống = giữ như hồ sơ cũ cùng taskId
   * (chạy lại task đã dừng không làm mất cờ), không có hồ sơ cũ thì false.
   */
  readonly persist?: boolean;
}

export class StartTaskHandler implements CommandHandler<
  StartTaskCommand,
  OperationStatus<TaskRecord>
> {
  constructor(
    private readonly _supervisor: TaskSupervisor,
    private readonly _kinds: TaskKindRegistry,
    private readonly _store: TaskSpecStore,
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
    const checked = this._kinds.validateParams(cmd.kind, cmd.params);
    if (!checked.ok)
      return {
        status: 'FAILED',
        reason: `INVALID_PARAMS cho ${cmd.kind}:\n${checked.error}`,
      };
    const records = await this._supervisor.list();
    const running = info.multiInstance
      ? undefined
      : records.find(
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

    const previous = records.find((r) => r.spec.taskId === cmd.taskId);
    if (previous && isActive(previous.state))
      return { status: 'FAILED', reason: `ALREADY_RUNNING: ${cmd.taskId}` };
    const persist = cmd.persist ?? previous?.spec.persist ?? false;
    const spec: TaskSpec = {
      taskId: cmd.taskId,
      kind: cmd.kind,
      params: checked.params,
      runtime: cmd.runtime,
      tenant: info.tenant,
      persist,
    };

    // ghi bền trước khi chạy: lỗi Postgres thì không tạo task "nửa vời" (chạy mà không được lưu)
    try {
      if (persist) await this._store.save({ spec, desired: 'running' });
      else await this._store.delete(spec.taskId);
    } catch (e: unknown) {
      return {
        status: 'FAILED',
        reason: `PERSIST_FAILED: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    return this._supervisor.start(spec);
  }
}
