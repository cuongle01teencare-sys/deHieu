import { WebSocketServer, type WebSocket } from 'ws';
import type {
  TaskConnection,
  TaskLauncher,
} from '../../application/task-launcher.js';
import {
  TASK_PROTOCOL_VERSION,
  type TaskToAppMessage,
} from '../../application/task-protocol.js';
import type { TaskRuntimeTarget, TaskSpec } from '../../domain/task-spec.js';
import {
  parseFrame,
  type AppToNodeFrame,
  type NodeToAppFrame,
} from './node-protocol.js';

interface RemoteTask {
  onMessage: ((msg: TaskToAppMessage) => void)[];
  onExit: ((reason: string) => void)[];
}

/**
 * App là WS server; microservice (node) chủ động kết nối vào, gửi hello + token.
 * Launcher chọn node theo runtime.nodeId rồi ghép kênh task theo taskId.
 */
export class WsRemoteTaskLauncher implements TaskLauncher {
  private _server: WebSocketServer | null = null;
  private readonly _nodes = new Map<string, WebSocket>();
  private readonly _tasks = new Map<
    string,
    { nodeId: string; t: RemoteTask }
  >();

  constructor(
    private readonly _port: number,
    private readonly _token: string,
  ) {}

  listen(): void {
    this._server = new WebSocketServer({ port: this._port });
    this._server.on('connection', (ws) => this._onConnection(ws));
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) =>
      this._server ? this._server.close(() => resolve()) : resolve(),
    );
  }

  connectedNodes(): string[] {
    return [...this._nodes.keys()];
  }

  supports(target: TaskRuntimeTarget): boolean {
    return target.type === 'remote';
  }

  launch(spec: TaskSpec): Promise<TaskConnection> {
    if (spec.runtime.type !== 'remote')
      return Promise.reject(new Error('NOT_REMOTE'));
    const nodeId = spec.runtime.nodeId;
    const ws = this._nodes.get(nodeId);
    if (!ws) return Promise.reject(new Error(`NODE_OFFLINE: ${nodeId}`));

    const t: RemoteTask = { onMessage: [], onExit: [] };
    this._tasks.set(spec.taskId, { nodeId, t });

    const conn: TaskConnection = {
      send: (msg) =>
        this._send(ws, {
          type: 'task',
          envelope: { v: TASK_PROTOCOL_VERSION, taskId: spec.taskId, msg },
        }),
      onMessage: (h) => t.onMessage.push(h),
      onExit: (h) => t.onExit.push(h),
      terminate: () => {
        this._tasks.delete(spec.taskId);
        this._send(ws, { type: 'kill', taskId: spec.taskId });
        return Promise.resolve();
      },
    };
    return Promise.resolve(conn);
  }

  private _onConnection(ws: WebSocket) {
    let nodeId: string | null = null;

    ws.on('message', (raw) => {
      const frame = parseFrame<NodeToAppFrame>(raw);
      if (!frame) return;

      if (frame.type === 'hello') {
        if (frame.token !== this._token) {
          this._send(ws, { type: 'rejected', reason: 'BAD_TOKEN' });
          return ws.close();
        }
        nodeId = frame.nodeId;
        this._nodes.get(nodeId)?.close(); // node cũ cùng id
        this._nodes.set(nodeId, ws);
        return this._send(ws, { type: 'welcome' });
      }
      if (!nodeId) return ws.close(); // chưa hello thì không nói chuyện

      if (frame.type === 'task') {
        const entry = this._tasks.get(frame.envelope.taskId);
        entry?.t.onMessage.forEach((h) => h(frame.envelope.msg));
      } else if (frame.type === 'task_closed') {
        const entry = this._tasks.get(frame.taskId);
        entry?.t.onExit.forEach((h) => h(frame.reason));
      }
    });

    ws.on('close', () => {
      if (!nodeId || this._nodes.get(nodeId) !== ws) return;
      this._nodes.delete(nodeId);
      for (const [taskId, entry] of this._tasks)
        if (entry.nodeId === nodeId) {
          this._tasks.delete(taskId);
          entry.t.onExit.forEach((h) => h(`NODE_DISCONNECTED: ${nodeId}`));
        }
    });
  }

  private _send(ws: WebSocket, frame: AppToNodeFrame) {
    ws.send(JSON.stringify(frame));
  }
}
