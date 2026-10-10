import type {
  Task,
  TaskCommandHandler,
  TaskContext,
  TaskFactory,
} from '../../application/task.js';
import type { AppToTaskMessage } from '../../application/task-protocol.js';
import type { TaskSpec } from '../../domain/task-spec.js';
import type { TaskEndpoint } from './task-endpoint.js';

/**
 * Chạy MỘT task theo giao thức init → ready → start → started → stop → stopped.
 * Dùng chung cho worker thread và microservice — đây là chỗ đảm bảo
 * "cùng một implementation, hai cách chạy".
 */
export class TaskRuntime {
  private _spec: TaskSpec | null = null;
  private _task: Task | null = null;
  private _abort: AbortController | null = null;
  private _running: Promise<void> | null = null;
  private _commandHandler: TaskCommandHandler | null = null;
  private _seq = 0;

  constructor(
    private readonly _endpoint: TaskEndpoint,
    private readonly _catalog: Readonly<Record<string, TaskFactory>>,
  ) {
    this._endpoint.onMessage((msg) => void this._handle(msg));
  }

  private async _handle(msg: AppToTaskMessage) {
    switch (msg.type) {
      case 'init': {
        const factory = this._catalog[msg.spec.kind];
        if (!factory)
          return this._endpoint.send({
            type: 'error',
            fatal: true,
            message: `UNKNOWN_TASK_KIND: ${msg.spec.kind}`,
          });
        this._spec = msg.spec;
        this._task = factory();
        return this._endpoint.send({ type: 'ready' });
      }
      case 'start':
        return this._start();
      case 'stop':
        await this.dispose();
        return this._endpoint.send({ type: 'stopped' });
      case 'heartbeat':
        return this._endpoint.send({ type: 'heartbeat', at: Date.now() });
      case 'command':
        try {
          await this._commandHandler?.(msg.name, msg.data);
          this._endpoint.send({
            type: 'command_ack',
            commandId: msg.commandId,
            ok: !!this._commandHandler,
            error: this._commandHandler ? undefined : 'NO_COMMAND_HANDLER',
          });
        } catch (e: unknown) {
          this._endpoint.send({
            type: 'command_ack',
            commandId: msg.commandId,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
    }
  }

  private _start() {
    if (!this._task || !this._spec || this._running) return;
    const spec = this._spec;
    const abort = new AbortController();
    this._abort = abort;

    const ctx: TaskContext = {
      taskId: spec.taskId,
      tenant: spec.tenant,
      params: spec.params,
      signal: abort.signal,
      emit: (payload, channel) =>
        this._endpoint.send({
          type: 'data',
          seq: ++this._seq,
          sentAt: Date.now(),
          channel,
          payload,
        }),
      onCommand: (handler) => {
        this._commandHandler = handler;
      },
    };

    this._running = this._task.run(ctx).catch((e: unknown) => {
      if (abort.signal.aborted) return;
      this._endpoint.send({
        type: 'error',
        fatal: true,
        message: e instanceof Error ? e.message : String(e),
      });
    });
    this._endpoint.send({ type: 'started' });
  }

  async dispose(): Promise<void> {
    this._abort?.abort();
    await this._running;
    this._running = null;
  }
}
