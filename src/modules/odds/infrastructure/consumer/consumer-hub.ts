import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { safeEqual } from '../../../../shared/infrastructure/security/safe-equal.js';
import {
  DEFAULT_HELLO_TIMEOUT_MS,
  SMALL_FRAME_BYTES,
  type WsServerLimits,
} from '../../../../shared/infrastructure/security/ws-limits.js';
import type { EventPublisher } from '../../../../shared/application/event-publisher.js';
import type { DomainEvent } from '../../../../shared/domain/domain-event.js';
import type { ArbitrageSignal } from '../../domain/arbitrage-signal.js';
import type {
  ConsumerControl,
  ConsumerHubStats,
  ConsumerView,
} from '../../application/consumer-control.js';
import {
  ArbitrageSignalCancelled,
  ArbitrageSignalIssued,
  ArbitrageSignalRefreshed,
} from '../../domain/events/arbitrage-signal.events.js';
import {
  CONSUMER_PROTOCOL_VERSION,
  type AppToConsumerFrame,
  type ConsumerRole,
  type ConsumerToAppFrame,
} from './consumer-protocol.js';

const rawToString = (raw: RawData): string =>
  Array.isArray(raw)
    ? Buffer.concat(raw).toString('utf8')
    : Buffer.from(raw as ArrayBuffer).toString('utf8');

interface Pending {
  frame: Extract<AppToConsumerFrame, { deliveryId: string }>;
  until: number;
  nextAt: number;
}

interface ConsumerSession {
  consumerId: string;
  role: ConsumerRole;
  ws: WebSocket | null;
  paused: boolean;
  lastSeenAt: number;
  pending: Map<string, Pending>;
}

export interface ConsumerHubOptions extends WsServerLimits {
  readonly port: number;
  readonly token: string;
  readonly retryIntervalMs?: number;
  readonly cancelRetryWindowMs?: number;
  /** Báo khi consumer kết nối / mất kết nối (để admin theo dõi). */
  readonly onPresence?: (
    change: 'connected' | 'disconnected',
    consumer: { consumerId: string; role: string },
  ) => void;
}

/**
 * Adapter đầu ra: EventPublisher → WebSocket tới các consumer nội bộ
 * (bot Discord, service giao dịch). Có ack + gửi lại + phát lại kèo khi kết nối lại.
 */
export class ConsumerHub implements EventPublisher, ConsumerControl {
  private _server: WebSocketServer | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _seq = 0;
  private readonly _sessions = new Map<string, ConsumerSession>();
  private readonly _active = new Map<string, ArbitrageSignal>();

  constructor(private readonly _opts: ConsumerHubOptions) {}

  listen(): void {
    this._server = new WebSocketServer({
      port: this._opts.port,
      host: this._opts.host,
      maxPayload: this._opts.maxPayloadBytes ?? SMALL_FRAME_BYTES,
    });
    this._server.on('connection', (ws) => this._onConnection(ws));
    this._timer = setInterval(
      () => this._tick(),
      this._opts.retryIntervalMs ?? 2_000,
    );
  }

  async close(): Promise<void> {
    if (this._timer) clearInterval(this._timer);
    await new Promise<void>((r) =>
      this._server ? this._server.close(() => r()) : r(),
    );
  }

  list(): ConsumerView[] {
    return [...this._sessions.values()].map((s) => ({
      consumerId: s.consumerId,
      role: s.role,
      connected: s.ws?.readyState === WebSocket.OPEN,
      paused: s.paused,
      pending: s.pending.size,
      lastSeenAt: s.lastSeenAt,
    }));
  }

  stats(): ConsumerHubStats {
    this._pruneExpired(Date.now());
    const consumers = this.list();
    return {
      activeSignals: this._active.size,
      pendingDeliveries: consumers.reduce((n, c) => n + c.pending, 0),
      signals: [...this._active.values()].sort((a, b) => b.margin - a.margin),
      consumers,
    };
  }

  /** Dừng/tiếp tục một consumer (vd ngừng gửi Discord, ngừng auto-trade). */
  control(consumerId: string, action: 'pause' | 'resume'): boolean {
    const s = this._sessions.get(consumerId);
    if (!s) return false;
    s.paused = action === 'pause';
    this._send(s, { type: 'control', action });
    return true;
  }

  publish(events: readonly DomainEvent[]): Promise<void> {
    for (const e of events) {
      if (
        e instanceof ArbitrageSignalIssued ||
        e instanceof ArbitrageSignalRefreshed
      ) {
        const supersedes =
          e instanceof ArbitrageSignalIssued
            ? (e.supersedes ?? undefined)
            : undefined;
        if (supersedes) this._dropSignal(supersedes); // ghi đè: bỏ kèo cũ, không gửi cancel
        this._active.set(e.signal.signalId, e.signal);
        const kind =
          e instanceof ArbitrageSignalIssued ? 'issued' : 'refreshed';
        for (const s of this._sessions.values())
          if (!s.paused) this._deliverSignal(s, e.signal, kind, supersedes);
      } else if (e instanceof ArbitrageSignalCancelled) {
        this._dropSignal(e.signalId); // kèo chưa giao xong thì bỏ luôn
        for (const s of this._sessions.values()) {
          this._enqueue(
            s,
            {
              type: 'cancel',
              deliveryId: this._nextId(),
              signalId: e.signalId,
              room: e.room,
              comboId: e.comboId,
              reason: e.reason,
            },
            Date.now() + (this._opts.cancelRetryWindowMs ?? 60_000),
          );
        }
      }
    }
    return Promise.resolve();
  }

  // ---------------------------------------------------------------- internals

  private _onConnection(ws: WebSocket) {
    let session: ConsumerSession | null = null;
    const helloTimer = setTimeout(() => {
      if (!session) ws.terminate();
    }, this._opts.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS);
    ws.on('close', () => clearTimeout(helloTimer));
    ws.on('error', () => ws.terminate());

    ws.on('message', (raw) => {
      let frame: ConsumerToAppFrame;
      try {
        frame = JSON.parse(rawToString(raw)) as ConsumerToAppFrame;
      } catch {
        return;
      }

      if (frame.type === 'hello') {
        if (
          !safeEqual(frame.token, this._opts.token) ||
          frame.v !== CONSUMER_PROTOCOL_VERSION ||
          typeof frame.consumerId !== 'string'
        ) {
          ws.send(JSON.stringify({ type: 'rejected', reason: 'BAD_HELLO' }));
          return ws.close();
        }
        clearTimeout(helloTimer);
        session = this._sessions.get(frame.consumerId) ?? {
          consumerId: frame.consumerId,
          role: frame.role,
          ws: null,
          paused: false,
          lastSeenAt: Date.now(),
          pending: new Map(),
        };
        session.ws?.close();
        session.ws = ws;
        session.role = frame.role;
        this._sessions.set(session.consumerId, session);
        this._send(session, { type: 'welcome', paused: session.paused });
        this._presence('connected', session);
        if (!session.paused) this._replay(session);
        return;
      }
      if (!session) return ws.close();
      session.lastSeenAt = Date.now();

      if (frame.type === 'ack') session.pending.delete(frame.deliveryId);
      else if (frame.type === 'heartbeat')
        this._send(session, { type: 'heartbeat', at: Date.now() });
    });

    ws.on('close', () => {
      if (session?.ws === ws) {
        session.ws = null;
        this._presence('disconnected', session);
      }
    });
  }

  private _presence(change: 'connected' | 'disconnected', s: ConsumerSession) {
    try {
      this._opts.onPresence?.(change, {
        consumerId: s.consumerId,
        role: s.role,
      });
    } catch {
      // quan sát không được làm hỏng kết nối consumer
    }
  }

  private _replay(s: ConsumerSession) {
    const now = Date.now();
    for (const signal of this._active.values())
      if (signal.expiresAt > now) this._deliverSignal(s, signal, 'refreshed');
  }

  private _deliverSignal(
    s: ConsumerSession,
    signal: ArbitrageSignal,
    kind: 'issued' | 'refreshed',
    supersedes?: string,
  ) {
    this._enqueue(
      s,
      { type: 'signal', deliveryId: this._nextId(), kind, signal, supersedes },
      signal.expiresAt,
    );
  }

  /** Bỏ kèo khỏi danh sách hiệu lực và khỏi mọi hàng đợi gửi lại. */
  private _dropSignal(signalId: string) {
    this._active.delete(signalId);
    for (const s of this._sessions.values())
      for (const [id, p] of s.pending)
        if (p.frame.type === 'signal' && p.frame.signal.signalId === signalId)
          s.pending.delete(id);
  }

  private _enqueue(s: ConsumerSession, frame: Pending['frame'], until: number) {
    s.pending.set(frame.deliveryId, { frame, until, nextAt: 0 });
    this._flush(s, Date.now());
  }

  private _pruneExpired(now: number) {
    for (const [id, s] of this._active)
      if (s.expiresAt <= now) this._active.delete(id);
  }

  private _tick() {
    const now = Date.now();
    this._pruneExpired(now);
    for (const s of this._sessions.values()) this._flush(s, now);
  }

  private _flush(s: ConsumerSession, now: number) {
    for (const [id, p] of s.pending) {
      if (now > p.until) {
        s.pending.delete(id);
        continue;
      }
      if (p.nextAt <= now && this._send(s, p.frame))
        p.nextAt = now + (this._opts.retryIntervalMs ?? 2_000);
    }
  }

  private _send(s: ConsumerSession, frame: AppToConsumerFrame): boolean {
    if (s.ws?.readyState !== WebSocket.OPEN) return false;
    s.ws.send(JSON.stringify(frame));
    return true;
  }

  private _nextId(): string {
    return `${Date.now().toString(36)}-${(++this._seq).toString(36)}`;
  }
}
