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
import type {
  NodeChange,
  NodeDirectory,
  NodeView,
} from '../../application/node-directory.js';
import {
  parseFrame,
  type AppToNodeFrame,
  type NodeToAppFrame,
} from './node-protocol.js';
import { safeEqual } from '../../../../shared/infrastructure/security/safe-equal.js';
import {
  DEFAULT_HELLO_TIMEOUT_MS,
  type WsServerLimits,
} from '../../../../shared/infrastructure/security/ws-limits.js';

interface RemoteTask {
  onMessage: ((msg: TaskToAppMessage) => void)[];
  onExit: ((reason: string) => void)[];
}

/**
 * App là WS server; microservice (node) chủ động kết nối vào, gửi hello + token.
 * Launcher chọn node theo runtime.nodeId rồi ghép kênh task theo taskId.
 */
export class WsRemoteTaskLauncher implements TaskLauncher, NodeDirectory {
  private _server: WebSocketServer | null = null;
  private readonly _nodes = new Map<string, WebSocket>();
  /** Mọi node từng kết nối trong lần chạy này (kể cả đã rớt) — để admin thấy node chết. */
  private readonly _seen = new Map<
    string,
    { connectedAt: number | null; disconnectedAt: number | null }
  >();
  private readonly _nodeListeners: ((c: NodeChange) => void)[] = [];
  private readonly _tasks = new Map<
    string,
    { nodeId: string; t: RemoteTask }
  >();

  constructor(
    private readonly _port: number,
    private readonly _token: string,
    /** Frame dữ liệu của node có thể lớn (snapshot, trang danh sách) → giới hạn rộng hơn kênh khác. */
    private readonly _limits: WsServerLimits = {},
  ) {}

  listen(): void {
    this._server = new WebSocketServer({
      port: this._port,
      host: this._limits.host,
      maxPayload: this._limits.maxPayloadBytes ?? 64 * 1024 * 1024,
    });
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

  list(): NodeView[] {
    return [...this._seen].map(([nodeId, s]) => ({
      nodeId,
      connected: this._nodes.has(nodeId),
      connectedAt: s.connectedAt,
      disconnectedAt: s.disconnectedAt,
      tasks: [...this._tasks.values()].filter((t) => t.nodeId === nodeId)
        .length,
    }));
  }

  onChange(listener: (change: NodeChange) => void): void {
    this._nodeListeners.push(listener);
  }

  private _emitNode(change: NodeChange) {
    for (const l of this._nodeListeners) {
      try {
        l(change);
      } catch {
        // listener quan sát không được làm hỏng kết nối node
      }
    }
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
    const helloTimer = setTimeout(() => {
      if (!nodeId) ws.terminate();
    }, this._limits.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS);
    ws.on('error', () => ws.terminate());

    ws.on('message', (raw) => {
      const frame = parseFrame<NodeToAppFrame>(raw);
      if (!frame) return;

      if (frame.type === 'hello') {
        if (
          !safeEqual(frame.token, this._token) ||
          typeof frame.nodeId !== 'string'
        ) {
          this._send(ws, { type: 'rejected', reason: 'BAD_TOKEN' });
          return ws.close();
        }
        clearTimeout(helloTimer);
        nodeId = frame.nodeId;
        this._nodes.get(nodeId)?.close(); // node cũ cùng id
        this._nodes.set(nodeId, ws);
        this._seen.set(nodeId, {
          connectedAt: Date.now(),
          disconnectedAt: null,
        });
        this._send(ws, { type: 'welcome' });
        this._emitNode({ type: 'connected', nodeId });
        return;
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
      clearTimeout(helloTimer);
      if (!nodeId || this._nodes.get(nodeId) !== ws) return;
      const id = nodeId;
      this._nodes.delete(id);
      const seen = this._seen.get(id);
      this._seen.set(id, {
        connectedAt: seen?.connectedAt ?? null,
        disconnectedAt: Date.now(),
      });
      const affected: string[] = [];
      for (const [taskId, entry] of this._tasks)
        if (entry.nodeId === id) {
          affected.push(taskId);
          this._tasks.delete(taskId);
          entry.t.onExit.forEach((h) => h(`NODE_DISCONNECTED: ${id}`));
        }
      this._emitNode({
        type: 'disconnected',
        nodeId: id,
        affectedTasks: affected,
      });
    });
  }

  private _send(ws: WebSocket, frame: AppToNodeFrame) {
    ws.send(JSON.stringify(frame));
  }
}
