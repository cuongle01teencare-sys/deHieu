import type { EventPublisher } from '../../../../shared/application/event-publisher.js';
import type { DomainEvent } from '../../../../shared/domain/domain-event.js';
import type { ArbitrageSignal } from '../../domain/arbitrage-signal.js';
import {
  ArbitrageSignalCancelled,
  ArbitrageSignalIssued,
  ArbitrageSignalRefreshed,
} from '../../domain/events/arbitrage-signal.events.js';
import {
  routeSignal,
  type NotifyChannel,
  type SignalTier,
} from '../../domain/notify-channel.js';
import type {
  NotifyConfigRepository,
  NotifyMessage,
  NotifySender,
} from './notify.ports.js';
import {
  cancelledMessage,
  issuedMessage,
  testMessage,
} from './signal-message.js';

/** Tình trạng gửi của một kênh (trong RAM, tính từ lúc app khởi động). */
export interface NotifyChannelStatus {
  readonly sent: number;
  readonly failed: number;
  readonly dropped: number;
  readonly queued: number;
  readonly lastSentAt: number | null;
  readonly lastError: string | null;
  readonly lastErrorAt: number | null;
}

export interface SignalNotifierOptions {
  /** Hàng đợi một kênh quá ngần này tin → bỏ tin mới (kênh chết / bị chặn). */
  readonly maxQueue: number;
  /** Giữ dấu vết kèo đã gửi thêm ngần này sau khi hết hạn (để gửi tin hủy). */
  readonly keepAfterExpiryMs: number;
}

const DEFAULTS: SignalNotifierOptions = {
  maxQueue: 50,
  keepAfterExpiryMs: 10 * 60_000,
};

interface Delivered {
  signal: ArbitrageSignal;
  channelIds: string[];
}

const EMPTY_STATUS: NotifyChannelStatus = {
  sent: 0,
  failed: 0,
  dropped: 0,
  queued: 0,
  lastSentAt: null,
  lastError: null,
  lastErrorAt: null,
};

/**
 * Adapter đầu ra (application): kèo → kênh Discord/Telegram/Slack theo hạng kèo admin cấu hình.
 * Chỉ gửi kèo mới (kể cả kèo ghi đè) và kèo bị hủy; bỏ qua lần phát lại (refreshed) để không spam.
 * Gửi chạy nền theo hàng đợi riêng từng kênh, không chặn luồng đánh giá kèo.
 */
export class SignalNotifier implements EventPublisher {
  private _tiers: SignalTier[] = [];
  private _channels: NotifyChannel[] = [];
  private readonly _delivered = new Map<string, Delivered>();
  private readonly _queues = new Map<string, Promise<void>>();
  private readonly _status = new Map<string, NotifyChannelStatus>();
  private readonly _opts: SignalNotifierOptions;

  constructor(
    private readonly _repo: NotifyConfigRepository,
    private readonly _sender: NotifySender,
    opts: Partial<SignalNotifierOptions> = {},
  ) {
    this._opts = { ...DEFAULTS, ...opts };
  }

  /** Nạp lại hạng + kênh từ Postgres (lúc khởi động và sau mỗi lần admin sửa). */
  async reload(): Promise<void> {
    const [tiers, channels] = await Promise.all([
      this._repo.listTiers(),
      this._repo.listChannels(),
    ]);
    this._tiers = tiers;
    this._channels = channels;
  }

  status(channelId: string): NotifyChannelStatus {
    return this._status.get(channelId) ?? EMPTY_STATUS;
  }

  /** Gửi tin kiểm tra NGAY (không qua hàng đợi), ném lỗi để admin thấy. */
  async sendTest(channel: NotifyChannel): Promise<void> {
    try {
      await this._sender.send(channel, testMessage(channel.name));
      this._mark(channel.id, { ok: true });
    } catch (e: unknown) {
      this._mark(channel.id, { ok: false, error: errorText(e) });
      throw e;
    }
  }

  /** Không bao giờ ném lỗi, không chờ gửi xong. */
  publish(events: readonly DomainEvent[]): Promise<void> {
    this._prune(Date.now());
    for (const e of events) {
      if (e instanceof ArbitrageSignalIssued) this._onIssued(e);
      else if (e instanceof ArbitrageSignalRefreshed) {
        const d = this._delivered.get(e.signal.signalId);
        if (d) d.signal = e.signal; // gia hạn: giữ dấu vết lâu hơn
      } else if (e instanceof ArbitrageSignalCancelled) this._onCancelled(e);
    }
    return Promise.resolve();
  }

  /** Chờ mọi hàng đợi gửi xong (test / tắt app). */
  async drain(): Promise<void> {
    await Promise.all([...this._queues.values()]);
  }

  // ---------------------------------------------------------------- internals

  private _onIssued(e: ArbitrageSignalIssued) {
    const previous = e.supersedes ? this._delivered.get(e.supersedes) : null;
    if (e.supersedes) this._delivered.delete(e.supersedes);
    const channelIds: string[] = [];
    for (const ch of this._channels) {
      const route = routeSignal(ch, this._tiers, e.signal.margin);
      if (!route) continue;
      const replaces = !!previous?.channelIds.includes(ch.id);
      if (this._enqueue(ch, issuedMessage(e.signal, route.tier, replaces)))
        channelIds.push(ch.id);
    }
    if (channelIds.length)
      this._delivered.set(e.signal.signalId, { signal: e.signal, channelIds });
  }

  private _onCancelled(e: ArbitrageSignalCancelled) {
    const d = this._delivered.get(e.signalId);
    if (!d) return; // kênh nào cũng chưa nhận kèo này → không báo hủy
    this._delivered.delete(e.signalId);
    const msg = cancelledMessage(d.signal, e.signalId, e.reason);
    for (const id of d.channelIds) {
      const ch = this._channels.find((c) => c.id === id && c.enabled);
      if (ch) this._enqueue(ch, msg);
    }
  }

  private _enqueue(ch: NotifyChannel, msg: NotifyMessage): boolean {
    const st = this.status(ch.id);
    if (st.queued >= this._opts.maxQueue) {
      this._status.set(ch.id, { ...st, dropped: st.dropped + 1 });
      return false;
    }
    this._status.set(ch.id, { ...st, queued: st.queued + 1 });
    const prev = this._queues.get(ch.id) ?? Promise.resolve();
    const next = prev
      .then(() => this._sender.send(ch, msg))
      .then(
        () => this._mark(ch.id, { ok: true, dequeued: true }),
        (err: unknown) =>
          this._mark(ch.id, {
            ok: false,
            error: errorText(err),
            dequeued: true,
          }),
      );
    this._queues.set(ch.id, next);
    void next.then(() => {
      if (this._queues.get(ch.id) === next) this._queues.delete(ch.id);
    });
    return true;
  }

  private _mark(
    id: string,
    r: { ok: boolean; error?: string; dequeued?: boolean },
  ) {
    const st = this.status(id);
    const now = Date.now();
    const queued = r.dequeued ? Math.max(0, st.queued - 1) : st.queued;
    this._status.set(
      id,
      r.ok
        ? { ...st, queued, sent: st.sent + 1, lastSentAt: now }
        : {
            ...st,
            queued,
            failed: st.failed + 1,
            lastError: r.error ?? 'unknown',
            lastErrorAt: now,
          },
    );
  }

  private _prune(now: number) {
    for (const [id, d] of this._delivered)
      if (d.signal.expiresAt + this._opts.keepAfterExpiryMs < now)
        this._delivered.delete(id);
  }
}

const errorText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
