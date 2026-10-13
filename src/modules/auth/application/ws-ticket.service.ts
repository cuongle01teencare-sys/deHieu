import { randomBytes } from 'node:crypto';
import type { Principal } from '../domain/principal.js';

export interface WsTicket {
  readonly ticket: string;
  readonly expiresAt: number;
}

/**
 * Vé dùng MỘT lần, sống ngắn, để trình duyệt mở WebSocket admin mà không cầm token API dài hạn.
 * Luồng: server web (giữ token) gọi POST /admin/ws-ticket → đưa vé cho trình duyệt →
 * trình duyệt gửi { type: 'hello', ticket } ngay khi mở kết nối.
 * Lưu trong RAM của tiến trình phát vé — chạy nhiều instance thì cần store chung (Redis).
 */
export class WsTicketService {
  private readonly _tickets = new Map<
    string,
    { principal: Principal; expiresAt: number }
  >();

  constructor(
    private readonly _ttlMs = 60_000,
    private readonly _now: () => number = Date.now,
    private readonly _random: () => string = () =>
      randomBytes(24).toString('base64url'),
  ) {}

  issue(principal: Principal): WsTicket {
    this._sweep();
    const ticket = this._random();
    const expiresAt = this._now() + this._ttlMs;
    this._tickets.set(ticket, { principal, expiresAt });
    return { ticket, expiresAt };
  }

  /** Đổi vé lấy principal; vé bị hủy ngay (dùng một lần). Hết hạn / không có → null. */
  redeem(ticket: string): Principal | null {
    const t = this._tickets.get(ticket);
    this._tickets.delete(ticket);
    return t && t.expiresAt > this._now() ? t.principal : null;
  }

  private _sweep() {
    const now = this._now();
    for (const [k, v] of this._tickets)
      if (v.expiresAt <= now) this._tickets.delete(k);
  }
}
