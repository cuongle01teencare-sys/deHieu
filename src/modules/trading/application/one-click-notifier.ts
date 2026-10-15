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
}

/** Port: gửi push (OneSignal). */
export interface PushSender {
  send(m: PushMessage): Promise<void>;
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

  async entered(c: OneClickCandidate): Promise<void> {
    if (!this._sender) return;
    await this._sender.send(await this.message(c));
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
