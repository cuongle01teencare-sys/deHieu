import type { OneClickCandidate } from './one-click-board.js';

/** Một thông báo đẩy tới điện thoại / trình duyệt đã đăng ký. */
export interface PushMessage {
  readonly title: string;
  readonly body: string;
  /** Mở khi bấm vào thông báo. */
  readonly url: string | null;
  /** Thông báo cùng khóa thay thế nhau trên thiết bị (không chồng nhiều cái cho cùng kèo). */
  readonly collapseId: string;
  /** Hết hạn sau (giây): kèo hết thì thông báo cũ cũng vô nghĩa. */
  readonly ttlSec: number;
  /** Chỉ gửi tới các thiết bị này (mã đăng ký OneSignal); bỏ trống = mọi thiết bị bật mục "Kèo". */
  readonly subscriptionIds?: readonly string[];
}

/** Kết quả OneSignal trả về: mã thông báo, lỗi (vd không thiết bị nào khớp). */
export interface PushResult {
  readonly id: string | null;
  readonly errors: readonly string[];
}

/** Port: gửi push (OneSignal). */
export interface PushSender {
  send(m: PushMessage): Promise<PushResult>;
}
export const PUSH_SENDER = Symbol('PUSH_SENDER');

const usd = (n: number) => `${n < 0 ? '-' : ''}${Math.abs(n).toFixed(2)}$`;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

/**
 * Báo về điện thoại khi có kèo MỚI lên bảng On click (lần đầu, hoặc quay lại sau khi đã rời bảng —
 * không tính lần mở lại do app khởi động lại, không báo mỗi lần làm mới).
 */
export class OneClickNotifier {
  constructor(
    private readonly _sender: PushSender | null,
    private readonly _profileName: (id: string) => Promise<string | null>,
    /** Gốc web (vd https://arbops.vercel.app) để bấm thông báo mở trang On click; null = không gắn link. */
    private readonly _webUrl: string | null,
    private readonly _now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this._sender !== null;
  }

  get webUrl(): string | null {
    return this._webUrl;
  }

  async entered(c: OneClickCandidate): Promise<void> {
    if (!this._sender) return;
    await this._sender.send(await this.message(c));
  }

  /**
   * Gửi thử THẬT qua OneSignal (cùng đường gửi kèo On click): tới một thiết bị (mã đăng ký của
   * trình duyệt đang bấm) hoặc mọi thiết bị đang bật mục "Kèo". null = chưa cấu hình OneSignal.
   */
  async test(by: string, subscriptionId?: string): Promise<PushResult | null> {
    if (!this._sender) return null;
    const at = new Date(this._now()).toLocaleTimeString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    return this._sender.send({
      title: 'Arb Ops: thông báo thử',
      body: `Gửi từ backend qua OneSignal lúc ${at} (bởi ${by}). Nhận được = kèo On click cũng sẽ báo về đây.`,
      url: this._webUrl
        ? `${this._webUrl.replace(/\/+$/, '')}/thong-bao`
        : null,
      collapseId: `test:${this._now()}`,
      ttlSec: 600,
      ...(subscriptionId ? { subscriptionIds: [subscriptionId] } : {}),
    });
  }

  async message(c: OneClickCandidate): Promise<PushMessage> {
    const a = c.analysis;
    const minAsk = (a.detail as { minAsk?: unknown }).minAsk;
    const profile = (await this._profileName(c.profileId)) ?? c.profileId;
    const tour = [
      a.book?.tournament
        ? `csgoempire ${a.book.tournament.no}/${a.book.tournament.of}`
        : null,
      a.polymarket?.tournament
        ? `Polymarket ${a.polymarket.tournament.no}/${a.polymarket.tournament.of}`
        : null,
    ].filter(Boolean);
    const lines = [
      `${pct(a.signalMargin)}${a.tierName ? ` · ${a.tierName}` : ''} · ${a.market} · ${a.phase}`,
      `Giá bán thấp nhất ${typeof minAsk === 'number' ? minAsk : '—'} · dự kiến lãi ${usd(a.profit)} (${pct(a.netMargin)}) trên ${usd(a.totalCost)}`,
      tour.length ? `Trận trong giải: ${tour.join(' · ')}` : null,
      `Profile ${profile}`,
    ].filter((x): x is string => !!x);
    return {
      title: `On click: ${a.teams[0]} vs ${a.teams[1]}`,
      body: lines.join('\n'),
      url: this._webUrl ? `${this._webUrl.replace(/\/+$/, '')}/on-click` : null,
      collapseId: `oneclick:${c.signalId}`.slice(0, 64),
      ttlSec: Math.max(60, Math.round((c.expiresAt - this._now()) / 1000)),
    };
  }
}
