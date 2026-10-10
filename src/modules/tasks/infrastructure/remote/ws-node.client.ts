import { WebSocket } from 'ws';
import type { TaskFactory } from '../../application/task.js';
import {
  TASK_PROTOCOL_VERSION,
  type AppToTaskMessage,
  type TaskToAppMessage,
} from '../../application/task-protocol.js';
import { TaskRuntime } from '../runtime/task-runtime.js';
import type { TaskEndpoint } from '../runtime/task-endpoint.js';
import {
  parseFrame,
  type AppToNodeFrame,
  type NodeToAppFrame,
} from './node-protocol.js';

export interface WsNodeClientOptions {
  readonly nodeId: string;
  readonly appUrl: string;
  readonly token: string;
  readonly catalog: Readonly<Record<string, TaskFactory>>;
  readonly maxReconnectDelayMs?: number;
}

/**
 * Chạy bên trong microservice task-runner. Kết nối về app, nhận task,
 * chạy bằng đúng TaskRuntime mà worker thread dùng.
 */
export class WsNodeClient {
  private _ws: WebSocket | null = null;
  private _closing = false;
  private _attempt = 0;
  private readonly _runtimes = new Map<
    string,
    { runtime: TaskRuntime; deliver: (m: AppToTaskMessage) => void }
  >();

  constructor(private readonly _opts: WsNodeClientOptions) {}

  connect(): void {
    const ws = new WebSocket(this._opts.appUrl);
    this._ws = ws;

    ws.on('open', () => {
      this._attempt = 0;
      this._send({
        type: 'hello',
        nodeId: this._opts.nodeId,
        token: this._opts.token,
      });
    });
    ws.on('message', (raw) => {
      const frame = parseFrame<AppToNodeFrame>(raw);
      if (frame) void this._onFrame(frame);
    });
    ws.on('close', () => void this._onClose());
    ws.on('error', () => ws.close());
  }

  async close(): Promise<void> {
    this._closing = true;
    await this._disposeAll();
    this._ws?.close();
  }

  private async _onFrame(frame: AppToNodeFrame) {
    switch (frame.type) {
      case 'welcome':
        return;
      case 'rejected':
        this._closing = true;
        throw new Error(`[WsNodeClient] bị từ chối: ${frame.reason}`);
      case 'kill': {
        const entry = this._runtimes.get(frame.taskId);
        this._runtimes.delete(frame.taskId);
        await entry?.runtime.dispose();
        return;
      }
      case 'task': {
        const { taskId, msg } = frame.envelope;
        if (!this._runtimes.has(taskId) && msg.type === 'init')
          this._createRuntime(taskId);
        this._runtimes.get(taskId)?.deliver(msg);
        return;
      }
    }
  }

  private _createRuntime(taskId: string) {
    let deliver: (m: AppToTaskMessage) => void = () => undefined;
    const endpoint: TaskEndpoint = {
      send: (msg: TaskToAppMessage) =>
        this._send({
          type: 'task',
          envelope: { v: TASK_PROTOCOL_VERSION, taskId, msg },
        }),
      onMessage: (h) => {
        deliver = h;
      },
    };
    const runtime = new TaskRuntime(endpoint, this._opts.catalog);
    this._runtimes.set(taskId, { runtime, deliver: (m) => deliver(m) });
  }

  private async _onClose() {
    // Mất kết nối: dừng mọi task; app coi như crash và tự khởi động lại khi node quay về.
    await this._disposeAll();
    if (this._closing) return;
    const delay = Math.min(
      1_000 * 2 ** this._attempt++,
      this._opts.maxReconnectDelayMs ?? 30_000,
    );
    setTimeout(() => this.connect(), delay);
  }

  private async _disposeAll() {
    const all = [...this._runtimes.values()];
    this._runtimes.clear();
    await Promise.all(all.map((e) => e.runtime.dispose()));
  }

  private _send(frame: NodeToAppFrame) {
    if (this._ws?.readyState === WebSocket.OPEN)
      this._ws.send(JSON.stringify(frame));
  }
}
