import type { NodeDirectory } from './node-directory.js';
import type { TaskSupervisor } from './task-supervisor.js';
import type { TaskSpecStore } from './task-spec.store.js';
import type { StartTaskHandler } from './commands/start-task.command.js';
import type { TaskSpec } from '../domain/task-spec.js';

export interface RestoreLogger {
  log(message: string): void;
  warn(message: string): void;
}

/**
 * Lúc app khởi động: nạp lại các task lưu bền.
 * - desired 'running' → chạy lại ngay (task trên node chưa kết nối → chờ node kết nối rồi chạy).
 * - desired 'stopped' → chỉ hiện hồ sơ STOPPED, chờ admin bấm chạy.
 */
export class RestorePersistedTasks {
  /** nodeId → task đang chờ node đó kết nối. */
  private readonly _waiting = new Map<string, TaskSpec[]>();

  constructor(
    private readonly _store: TaskSpecStore,
    private readonly _supervisor: TaskSupervisor,
    private readonly _start: StartTaskHandler,
    private readonly _nodes: NodeDirectory,
    private readonly _logger: RestoreLogger,
  ) {
    this._nodes.onChange((c) => {
      if (c.type === 'connected') void this._startWaiting(c.nodeId);
    });
  }

  async run(): Promise<void> {
    const tasks = await this._store.list();
    if (!tasks.length) return;
    const connected = new Set(
      this._nodes
        .list()
        .filter((n) => n.connected)
        .map((n) => n.nodeId),
    );
    let started = 0;
    for (const { spec, desired } of tasks) {
      if (desired === 'stopped') {
        await this._supervisor.restore(spec);
        continue;
      }
      if (
        spec.runtime.type === 'remote' &&
        !connected.has(spec.runtime.nodeId)
      ) {
        const nodeId = spec.runtime.nodeId;
        await this._supervisor.restore(spec, `chờ node ${nodeId} kết nối`);
        this._waiting.set(nodeId, [...(this._waiting.get(nodeId) ?? []), spec]);
        continue;
      }
      if (await this._run(spec)) started++;
    }
    const waiting = [...this._waiting.values()].flat().length;
    this._logger.log(
      `đã nạp ${tasks.length} task lưu bền: chạy ${started}` +
        (waiting ? `, chờ node ${waiting}` : ''),
    );
  }

  private async _startWaiting(nodeId: string) {
    const specs = this._waiting.get(nodeId);
    if (!specs) return;
    this._waiting.delete(nodeId);
    for (const spec of specs) {
      // admin có thể đã xóa / tự chạy task trong lúc chờ
      const record = await this._supervisor.get(spec.taskId);
      if (record?.state === 'STOPPED') await this._run(spec);
    }
  }

  private async _run(spec: TaskSpec): Promise<boolean> {
    const r = await this._start.execute({ ...spec, persist: true });
    if (r.status === 'SUCEED') return true;
    const reason = r.status === 'FAILED' ? r.reason : r.status;
    this._logger.warn(`không chạy lại được task ${spec.taskId}: ${reason}`);
    await this._supervisor.restore(spec, `khởi động lại thất bại: ${reason}`);
    return false;
  }
}
