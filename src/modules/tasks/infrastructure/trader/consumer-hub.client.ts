import { WebSocket, type RawData } from 'ws';
import { sleep } from '../shared/abortable.js';

/**
 * Client của ConsumerHub (WS app → consumer). Giao thức là hợp đồng dây (wire) với app,
 * khai báo lại ở đây để worker không phụ thuộc hạ tầng của module odds:
 *   → hello {v:1, consumerId, role, token}       ← welcome | rejected
 *   ← signal {deliveryId, kind, signal}           → ack {deliveryId}
 *   ← cancel {deliveryId, signalId, room, ...}    → ack {deliveryId}
 *   ← control {pause|resume}                      → paused | resumed
 *   hai chiều: heartbeat
 * App gửi lại tới khi có ack ⇒ có thể nhận trùng: nơi dùng phải bỏ trùng theo signalId.
 */
export interface HubLeg {
  readonly tenant: string;
  readonly side: number;
  readonly pick: string;
  readonly odds: number;
  readonly ref: Readonly<Record<string, string>>;
  /** Giờ bắt đầu trận theo tenant của chân này lúc phát (app cũ không gửi). */
  readonly startsAt?: number;
}

export interface HubSignal {
  readonly signalId: string;
  readonly room: string;
  readonly sport: string;
  readonly market: string;
  readonly teams: readonly [string, string];
  readonly comboId: string;
  readonly phase: string;
  readonly margin: number;
  readonly legs: readonly HubLeg[];
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface HubCancel {
  readonly signalId: string;
  readonly room: string;
  readonly comboId: string;
  readonly reason: string;
  /** Giờ bắt đầu từng chân + độ lệch lúc hủy (app cũ không gửi). */
  readonly detail?: {
    readonly startTimes: readonly {
      readonly tenant: string;
      readonly startsAt: number;
    }[];
    readonly startDriftMs: number | null;
    readonly maxStartDriftMs: number;
  };
}

export interface ConsumerHubHandlers {
  onSignal(s: HubSignal, kind: string): void;
  onCancel(c: HubCancel): void;
  onState(
    state: 'connected' | 'disconnected' | 'paused' | 'resumed',
    detail?: string,
  ): void;
}

export interface ConsumerHubClientOptions {
  readonly url: string;
  readonly token: string;
  readonly consumerId: string;
  readonly heartbeatMs?: number;
  readonly maxBackoffMs?: number;
}

type Frame = Record<string, unknown> & { type?: unknown };

const rawText = (raw: RawData): string =>
  Array.isArray(raw)
    ? Buffer.concat(raw).toString('utf8')
    : Buffer.from(raw as ArrayBuffer).toString('utf8');

export class ConsumerHubClient {
  private _ws: WebSocket | null = null;
  private _paused = false;

  constructor(
    private readonly _opts: ConsumerHubClientOptions,
    private readonly _h: ConsumerHubHandlers,
  ) {}

  get paused(): boolean {
    return this._paused;
  }

  /** Giữ kết nối (tự nối lại, lùi dần) tới khi signal abort. */
  async run(signal: AbortSignal): Promise<void> {
    let backoff = 500;
    while (!signal.aborted) {
      const welcomed = await this._connectOnce(signal);
      if (signal.aborted) break;
      backoff = welcomed
        ? 500
        : Math.min(backoff * 2, this._opts.maxBackoffMs ?? 15_000);
      await sleep(backoff, signal);
    }
  }

  /** Mở một kết nối, trả true nếu đã được welcome (để reset lùi dần). */
  private _connectOnce(signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      let welcomed = false;
      const ws = new WebSocket(this._opts.url);
      this._ws = ws;
      const hb = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN)
          this._send({ type: 'heartbeat', at: Date.now() });
      }, this._opts.heartbeatMs ?? 15_000);
      const abort = () => ws.close();
      signal.addEventListener('abort', abort, { once: true });

      ws.on('open', () =>
        this._send({
          type: 'hello',
          v: 1,
          consumerId: this._opts.consumerId,
          role: 'trader',
          token: this._opts.token,
        }),
      );
      ws.on('message', (raw) => {
        let f: Frame;
        try {
          f = JSON.parse(rawText(raw)) as Frame;
        } catch {
          return;
        }
        if (f.type === 'welcome') {
          welcomed = true;
          this._paused = f.paused === true;
          this._h.onState('connected', this._paused ? 'paused' : undefined);
        } else if (f.type === 'rejected') {
          this._h.onState('disconnected', `hub từ chối: ${String(f.reason)}`);
        } else if (f.type === 'signal' || f.type === 'cancel') {
          // ack ngay khi nhận: xử lý chậm không được khiến hub gửi lại liên tục
          if (typeof f.deliveryId === 'string')
            this._send({ type: 'ack', deliveryId: f.deliveryId });
          if (f.type === 'signal' && f.signal && typeof f.signal === 'object')
            this._h.onSignal(f.signal as HubSignal, String(f.kind));
          else if (f.type === 'cancel' && typeof f.signalId === 'string')
            this._h.onCancel(f as unknown as HubCancel);
        } else if (f.type === 'control') {
          this._paused = f.action === 'pause';
          this._send({ type: this._paused ? 'paused' : 'resumed' });
          this._h.onState(this._paused ? 'paused' : 'resumed');
        }
      });
      ws.on('error', () => undefined); // 'close' theo sau
      ws.on('close', () => {
        clearInterval(hb);
        signal.removeEventListener('abort', abort);
        if (this._ws === ws) this._ws = null;
        if (welcomed) this._h.onState('disconnected');
        resolve(welcomed);
      });
    });
  }

  private _send(frame: Record<string, unknown>) {
    if (this._ws?.readyState === WebSocket.OPEN)
      this._ws.send(JSON.stringify(frame));
  }
}
