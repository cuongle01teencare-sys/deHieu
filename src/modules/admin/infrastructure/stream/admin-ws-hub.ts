import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { OpsEventBus } from '../../../../shared/application/ops-event-bus.js';
import type { Authenticator } from '../../../auth/application/authenticator.js';
import type { AuthorizationService } from '../../../auth/application/authorization.service.js';
import { ADMIN_PERMISSIONS } from '../../application/admin.permissions.js';
import {
  ADMIN_TOPICS,
  DEFAULT_TOPICS,
  MAX_ROOM_TOPICS,
  ROOM_TOPIC_PREFIX,
  type AdminClientFrame,
  type AdminServerFrame,
} from '../../application/admin-stream-protocol.js';
import type { MetricsSampler } from '../../application/metrics-sampler.js';
import type { GetAdminSnapshotHandler } from '../../application/queries/get-admin-snapshot.query.js';

export interface AdminWsHubOptions {
  readonly port: number;
  readonly metricsIntervalMs?: number;
  readonly helloTimeoutMs?: number;
  readonly pingIntervalMs?: number;
  /** Vượt ngưỡng bộ đệm gửi (client chậm) → bỏ sự kiện thường cho client đó. */
  readonly maxBufferedBytes?: number;
}

type Principal = NonNullable<
  Awaited<ReturnType<Authenticator['authenticate']>>
>;

interface Client {
  ws: WebSocket;
  principal: Principal | null;
  topics: Set<string>;
  alive: boolean;
  dropped: number;
}

const raw2str = (raw: RawData): string =>
  Array.isArray(raw)
    ? Buffer.concat(raw).toString('utf8')
    : Buffer.from(raw as ArrayBuffer).toString('utf8');

const TOPIC_SET = new Set<string>(ADMIN_TOPICS);

/**
 * WebSocket cho dashboard admin: xác thực bằng token API (cần admin:read),
 * gửi snapshot lúc vào, sau đó đẩy sự kiện theo topic + metrics định kỳ.
 */
export class AdminWsHub {
  private _server: WebSocketServer | null = null;
  private readonly _clients = new Set<Client>();
  private _timers: ReturnType<typeof setInterval>[] = [];
  private _unsubscribe: (() => void) | null = null;
  private _sampling = false;

  constructor(
    private readonly _opts: AdminWsHubOptions,
    private readonly _ops: OpsEventBus,
    private readonly _auth: Authenticator,
    private readonly _authz: AuthorizationService,
    private readonly _snapshot: GetAdminSnapshotHandler,
    private readonly _metrics: MetricsSampler,
    private readonly _room: (room: string) => Promise<unknown>,
    private readonly _onError: (message: string) => void = () => undefined,
  ) {}

  listen(): void {
    this._server = new WebSocketServer({ port: this._opts.port });
    this._server.on('connection', (ws) => this._onConnection(ws));
    this._server.on('error', (e) => this._onError(`admin ws: ${e.message}`));
    this._unsubscribe = this._ops.subscribe((event) => {
      const frame: AdminServerFrame = { type: 'event', event };
      for (const c of this._clients)
        if (c.principal && c.topics.has(event.topic))
          this._send(c, frame, true);
    });
    this._timers.push(
      setInterval(
        () => void this._broadcastMetrics(),
        this._opts.metricsIntervalMs ?? 2_000,
      ),
      setInterval(() => this._heartbeat(), this._opts.pingIntervalMs ?? 30_000),
    );
  }

  async close(): Promise<void> {
    this._unsubscribe?.();
    this._timers.forEach(clearInterval);
    this._timers = [];
    for (const c of this._clients) c.ws.terminate();
    await new Promise<void>((r) =>
      this._server ? this._server.close(() => r()) : r(),
    );
  }

  /** Cổng thật đang nghe (hữu ích khi cấu hình port 0 trong test). */
  port(): number {
    const a = this._server?.address();
    return typeof a === 'object' && a ? a.port : this._opts.port;
  }

  stats() {
    return {
      clients: this._clients.size,
      authenticated: [...this._clients].filter((c) => c.principal).length,
    };
  }

  private _onConnection(ws: WebSocket) {
    const client: Client = {
      ws,
      principal: null,
      topics: new Set(),
      alive: true,
      dropped: 0,
    };
    this._clients.add(client);
    const helloTimer = setTimeout(() => {
      if (!client.principal) {
        this._send(client, { type: 'rejected', reason: 'HELLO_TIMEOUT' });
        ws.close();
      }
    }, this._opts.helloTimeoutMs ?? 10_000);

    ws.on('pong', () => (client.alive = true));
    ws.on('close', () => {
      clearTimeout(helloTimer);
      this._clients.delete(client);
    });
    ws.on('error', () => ws.terminate());
    ws.on('message', (raw) => {
      let frame: AdminClientFrame;
      try {
        frame = JSON.parse(raw2str(raw)) as AdminClientFrame;
      } catch {
        return this._send(client, { type: 'error', message: 'BAD_JSON' });
      }
      void this._onFrame(client, frame).catch((e: unknown) =>
        this._send(client, {
          type: 'error',
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    });
  }

  private async _onFrame(c: Client, frame: AdminClientFrame) {
    if (frame.type === 'hello') {
      if (c.principal) return;
      const principal =
        typeof frame.token === 'string'
          ? await this._auth.authenticate({
              authorization: `Bearer ${frame.token}`,
            })
          : null;
      if (!principal) {
        this._send(c, { type: 'rejected', reason: 'UNAUTHORIZED' });
        return c.ws.close();
      }
      if (!(await this._authz.can(principal, [ADMIN_PERMISSIONS.READ]))) {
        this._send(c, {
          type: 'rejected',
          reason: `FORBIDDEN: cần quyền ${ADMIN_PERMISSIONS.READ}`,
        });
        return c.ws.close();
      }
      c.principal = principal;
      const rejected = this._subscribe(
        c,
        Array.isArray(frame.topics) ? frame.topics : [...DEFAULT_TOPICS],
      );
      this._send(c, {
        type: 'welcome',
        principal: { id: principal.id, roles: principal.roles },
        topics: [...c.topics],
      });
      if (rejected.length)
        this._send(c, {
          type: 'error',
          message: `Topic không hợp lệ: ${rejected.join(', ')}`,
        });
      this._send(c, { type: 'snapshot', data: await this._snapshot.execute() });
      await this._sendRooms(c, [...c.topics]);
      return;
    }
    if (!c.principal) return c.ws.close();

    switch (frame.type) {
      case 'subscribe': {
        const topics = Array.isArray(frame.topics) ? frame.topics : [];
        const fresh = topics.filter((t) => !c.topics.has(t));
        const rejected = this._subscribe(c, topics);
        if (rejected.length)
          this._send(c, {
            type: 'error',
            message: `Topic không hợp lệ: ${rejected.join(', ')}`,
          });
        await this._sendRooms(
          c,
          fresh.filter((t) => c.topics.has(t)),
        );
        return;
      }
      case 'unsubscribe':
        (Array.isArray(frame.topics) ? frame.topics : []).forEach((t) =>
          c.topics.delete(t),
        );
        return;
      case 'resync':
        this._send(c, {
          type: 'snapshot',
          data: await this._snapshot.execute(),
        });
        return;
      case 'ping':
        this._send(c, { type: 'pong' });
        return;
    }
  }

  /** Trả về các topic bị từ chối. */
  private _subscribe(c: Client, topics: readonly string[]): string[] {
    const rejected: string[] = [];
    for (const t of topics) {
      if (typeof t !== 'string') continue;
      if (TOPIC_SET.has(t)) c.topics.add(t);
      else if (
        t.startsWith(ROOM_TOPIC_PREFIX) &&
        t.length > ROOM_TOPIC_PREFIX.length
      ) {
        const rooms = [...c.topics].filter((x) =>
          x.startsWith(ROOM_TOPIC_PREFIX),
        );
        if (rooms.length >= MAX_ROOM_TOPICS)
          rejected.push(`${t} (tối đa ${MAX_ROOM_TOPICS} room)`);
        else c.topics.add(t);
      } else rejected.push(t);
    }
    return rejected;
  }

  private async _sendRooms(c: Client, topics: readonly string[]) {
    for (const t of topics)
      if (t.startsWith(ROOM_TOPIC_PREFIX)) {
        const room = t.slice(ROOM_TOPIC_PREFIX.length);
        this._send(c, { type: 'room', room, data: await this._room(room) });
      }
  }

  private async _broadcastMetrics() {
    const targets = [...this._clients].filter(
      (c) => c.principal && c.topics.has('metrics'),
    );
    if (!targets.length || this._sampling) return;
    this._sampling = true;
    try {
      const data = await this._metrics.sample();
      for (const c of targets) this._send(c, { type: 'metrics', data }, true);
    } catch (e: unknown) {
      this._onError(`metrics: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this._sampling = false;
    }
  }

  private _heartbeat() {
    for (const c of this._clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }

  private _send(c: Client, frame: AdminServerFrame, droppable = false) {
    if (c.ws.readyState !== c.ws.OPEN) return;
    if (
      droppable &&
      c.ws.bufferedAmount > (this._opts.maxBufferedBytes ?? 5_000_000)
    ) {
      c.dropped++;
      return;
    }
    c.ws.send(JSON.stringify(frame));
  }
}
