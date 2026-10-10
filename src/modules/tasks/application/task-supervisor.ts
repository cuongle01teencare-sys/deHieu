import { randomUUID } from 'node:crypto';
import type { OperationStatus } from '../../../shared/domain/domain-repository.js';
import type { TaskRecord } from '../domain/task-record.js';
import type { TaskSpec } from '../domain/task-spec.js';
import {
  canTransition,
  isActive,
  type TaskState,
} from '../domain/task-state.js';
import {
  DEFAULT_RESTART_POLICY,
  nextRestartDelay,
  type RestartPolicy,
} from '../domain/restart-policy.js';
import type { TaskConnection, TaskLauncher } from './task-launcher.js';
import type { TaskRegistry } from './task-registry.js';
import type { TaskAlertNotifier } from './task-alert.notifier.js';
import type { TaskDataMessage, TaskToAppMessage } from './task-protocol.js';

export interface TaskSupervisorOptions {
  readonly handshakeTimeoutMs: number;
  readonly stopTimeoutMs: number;
  readonly commandTimeoutMs: number;
  readonly heartbeatIntervalMs: number;
  readonly heartbeatTimeoutMs: number;
  readonly restartPolicy: RestartPolicy;
}

export const DEFAULT_SUPERVISOR_OPTIONS: TaskSupervisorOptions = {
  handshakeTimeoutMs: 10_000,
  stopTimeoutMs: 5_000,
  commandTimeoutMs: 5_000,
  heartbeatIntervalMs: 5_000,
  heartbeatTimeoutMs: 15_000,
  restartPolicy: DEFAULT_RESTART_POLICY,
};

export type TaskDataListener = (msg: TaskDataMessage) => void | Promise<void>;

/** Publisher dừng hẳn (FAILED sau khi hết lượt khởi động lại, hoặc admin stop). */
export type TaskGoneListener = (record: TaskRecord) => void | Promise<void>;

interface Live {
  conn: TaskConnection | null;
  desired: 'running' | 'stopped';
  timers: Set<ReturnType<typeof setTimeout>>;
  pending: Map<string, (ok: boolean, error?: string) => void>;
  onStopped?: () => void;
}

/**
 * Application service: điều phối vòng đời MỌI publisher theo một giao thức duy nhất,
 * không quan tâm task chạy ở worker thread hay microservice (do TaskLauncher lo).
 */
export class TaskSupervisor {
  private readonly _live = new Map<string, Live>();
  private readonly _listeners: TaskDataListener[] = [];
  private readonly _goneListeners: TaskGoneListener[] = [];

  constructor(
    private readonly _launchers: readonly TaskLauncher[],
    private readonly _registry: TaskRegistry,
    private readonly _notifier: TaskAlertNotifier,
    private readonly _opts: TaskSupervisorOptions = DEFAULT_SUPERVISOR_OPTIONS,
  ) {}

  onData(listener: TaskDataListener): void {
    this._listeners.push(listener);
  }

  onTaskGone(listener: TaskGoneListener): void {
    this._goneListeners.push(listener);
  }

  async start(spec: TaskSpec): Promise<OperationStatus<TaskRecord>> {
    const existing = await this._registry.get(spec.taskId);
    if (existing && isActive(existing.state))
      return { status: 'FAILED', reason: `ALREADY_RUNNING: ${spec.taskId}` };

    const launcher = this._launchers.find((l) => l.supports(spec.runtime));
    if (!launcher)
      return {
        status: 'FAILED',
        reason: `NO_LAUNCHER: runtime ${JSON.stringify(spec.runtime)}`,
      };

    const record: TaskRecord = {
      spec,
      state: 'CREATED',
      consecutiveFailures: 0,
      totalRestarts: existing?.totalRestarts ?? 0,
      lastHeartbeatAt: null,
      lastDataAt: null,
      lastSeq: null,
      lastError: null,
      updatedAt: Date.now(),
    };
    await this._registry.save(record);
    this._live.set(spec.taskId, {
      conn: null,
      desired: 'running',
      timers: new Set(),
      pending: new Map(),
    });

    await this._spawn(spec.taskId);
    const saved = await this._registry.get(spec.taskId);
    return saved ? { status: 'SUCEED', data: saved } : { status: 'NOT_FOUND' };
  }

  async stop(taskId: string): Promise<OperationStatus<TaskRecord>> {
    const live = this._live.get(taskId);
    const record = await this._registry.get(taskId);
    if (!live || !record) return { status: 'NOT_FOUND' };

    live.desired = 'stopped';
    if (!live.conn) {
      await this._transition(taskId, 'STOPPED');
    } else {
      await this._transition(taskId, 'STOPPING');
      await new Promise<void>((resolve) => {
        live.onStopped = resolve;
        live.conn?.send({ type: 'stop' });
        this._timer(live, this._opts.stopTimeoutMs, () => resolve());
      });
      await this._dispose(taskId);
      await this._transition(taskId, 'STOPPED');
    }
    const saved = await this._registry.get(taskId);
    return saved ? { status: 'SUCEED', data: saved } : { status: 'NOT_FOUND' };
  }

  async command(
    taskId: string,
    name: string,
    data: unknown,
  ): Promise<OperationStatus<true>> {
    const live = this._live.get(taskId);
    if (!live?.conn) return { status: 'NOT_FOUND' };
    const commandId = randomUUID();

    return new Promise((resolve) => {
      const finish = (ok: boolean, error?: string) => {
        live.pending.delete(commandId);
        resolve(
          ok
            ? { status: 'SUCEED', data: true }
            : { status: 'FAILED', reason: error ?? 'COMMAND_REJECTED' },
        );
      };
      live.pending.set(commandId, finish);
      this._timer(live, this._opts.commandTimeoutMs, () =>
        finish(false, 'COMMAND_TIMEOUT'),
      );
      live.conn?.send({ type: 'command', commandId, name, data });
    });
  }

  list(): Promise<TaskRecord[]> {
    return this._registry.list();
  }

  get(taskId: string): Promise<TaskRecord | null> {
    return this._registry.get(taskId);
  }

  // ---------------------------------------------------------------- internals

  private async _spawn(taskId: string): Promise<void> {
    const live = this._live.get(taskId);
    const record = await this._registry.get(taskId);
    if (!live || !record) return;
    const launcher = this._launchers.find((l) =>
      l.supports(record.spec.runtime),
    );
    if (!launcher) return;

    await this._transition(taskId, 'INITIALIZING');
    try {
      const conn = await launcher.launch(record.spec);
      live.conn = conn;
      conn.onMessage((msg) => void this._onMessage(taskId, msg));
      conn.onExit((reason) => void this._onCrash(taskId, `EXIT: ${reason}`));
      conn.send({ type: 'init', spec: record.spec });
      this._timer(live, this._opts.handshakeTimeoutMs, async () => {
        const r = await this._registry.get(taskId);
        if (r && (r.state === 'INITIALIZING' || r.state === 'STARTING'))
          await this._onCrash(taskId, 'HANDSHAKE_TIMEOUT');
      });
      this._startHeartbeat(taskId);
    } catch (e: unknown) {
      await this._onCrash(taskId, e instanceof Error ? e.message : String(e));
    }
  }

  private async _onMessage(taskId: string, msg: TaskToAppMessage) {
    const live = this._live.get(taskId);
    const record = await this._registry.get(taskId);
    if (!live || !record) return;

    switch (msg.type) {
      case 'ready':
        await this._transition(taskId, 'READY');
        if (live.desired === 'running') {
          await this._transition(taskId, 'STARTING');
          live.conn?.send({ type: 'start' });
        }
        return;
      case 'started':
        await this._transition(taskId, 'RUNNING');
        return;
      case 'stopped':
        live.onStopped?.();
        return;
      case 'heartbeat':
        await this._patch(taskId, { lastHeartbeatAt: Date.now() });
        return;
      case 'command_ack':
        live.pending.get(msg.commandId)?.(msg.ok, msg.error);
        return;
      case 'error':
        if (msg.fatal) await this._onCrash(taskId, msg.message);
        else await this._patch(taskId, { lastError: msg.message });
        return;
      case 'data': {
        if (record.lastSeq !== null && msg.seq <= record.lastSeq) return; // đến muộn
        const receivedAt = Date.now();
        // task đã gửi được dữ liệu = chạy ổn → reset bộ đếm thất bại liên tiếp
        await this._patch(taskId, {
          lastSeq: msg.seq,
          lastDataAt: receivedAt,
          consecutiveFailures: 0,
        });
        const data: TaskDataMessage = {
          taskId,
          tenant: record.spec.tenant,
          kind: record.spec.kind,
          seq: msg.seq,
          sentAt: msg.sentAt,
          receivedAt,
          channel: msg.channel,
          payload: msg.payload,
        };
        for (const l of this._listeners) await l(data);
        return;
      }
    }
  }

  private async _onCrash(taskId: string, reason: string) {
    const live = this._live.get(taskId);
    const record = await this._registry.get(taskId);
    if (!live || !record) return;
    if (live.desired === 'stopped' || !isActive(record.state)) return;

    await this._dispose(taskId);
    const failures = record.consecutiveFailures + 1;
    const delay = nextRestartDelay(failures, this._opts.restartPolicy);

    if (delay === null) {
      await this._transition(taskId, 'FAILED', {
        consecutiveFailures: failures,
        lastError: reason,
      });
      const failed = await this._registry.get(taskId);
      if (failed) await this._notifier.taskDied(failed, reason);
      return;
    }

    await this._transition(taskId, 'RESTARTING', {
      consecutiveFailures: failures,
      totalRestarts: record.totalRestarts + 1,
      lastError: reason,
      lastSeq: null, // task mới đánh seq lại từ đầu
    });
    this._timer(live, delay, () => this._spawn(taskId));
  }

  private _startHeartbeat(taskId: string) {
    const live = this._live.get(taskId);
    if (!live) return;
    const tick = async () => {
      const r = await this._registry.get(taskId);
      if (!r || !live.conn) return;
      live.conn.send({ type: 'heartbeat', at: Date.now() });
      const last = r.lastHeartbeatAt ?? r.updatedAt;
      if (
        r.state === 'RUNNING' &&
        Date.now() - last > this._opts.heartbeatTimeoutMs
      )
        return this._onCrash(taskId, 'HEARTBEAT_TIMEOUT');
      this._timer(live, this._opts.heartbeatIntervalMs, tick);
    };
    this._timer(live, this._opts.heartbeatIntervalMs, tick);
  }

  private async _dispose(taskId: string) {
    const live = this._live.get(taskId);
    if (!live) return;
    live.timers.forEach(clearTimeout);
    live.timers.clear();
    live.pending.forEach((finish) => finish(false, 'TASK_GONE'));
    const conn = live.conn;
    live.conn = null;
    await conn?.terminate();
  }

  private _timer(live: Live, ms: number, fn: () => unknown) {
    const t = setTimeout(() => {
      live.timers.delete(t);
      void fn();
    }, ms);
    live.timers.add(t);
  }

  private async _transition(
    taskId: string,
    to: TaskState,
    patch: Partial<TaskRecord> = {},
  ) {
    const r = await this._registry.get(taskId);
    if (!r || r.state === to) return this._patch(taskId, patch);
    if (!canTransition(r.state, to)) return;
    await this._registry.save({
      ...r,
      ...patch,
      state: to,
      updatedAt: Date.now(),
    });
    if (to === 'FAILED' || to === 'STOPPED') {
      const gone = await this._registry.get(taskId);
      if (gone) for (const l of this._goneListeners) await l(gone);
    }
  }

  private async _patch(taskId: string, patch: Partial<TaskRecord>) {
    const r = await this._registry.get(taskId);
    if (r) await this._registry.save({ ...r, ...patch, updatedAt: Date.now() });
  }
}
