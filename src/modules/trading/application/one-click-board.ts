import { z } from 'zod';
import { TradeAttemptSchema, type TradeAttempt } from './trade-attempt.js';

/** Payload kênh 'oneclick' của task trader. */
const OneClickMessageSchema = z.union([
  z.object({
    profileId: z.string().min(1),
    signalId: z.string().min(1),
    removed: z.literal(true),
  }),
  z.object({
    profileId: z.string().min(1),
    signalId: z.string().min(1),
    expiresAt: z.number().finite(),
    candidate: TradeAttemptSchema,
  }),
]);

export interface OneClickCandidate {
  readonly profileId: string;
  readonly signalId: string;
  readonly expiresAt: number;
  /** Lúc trader gửi bản phân tích này (ms). */
  readonly updatedAt: number;
  /** "Nếu vào bây giờ": cùng phân tích bot dùng để vào lệnh (status paper_filled = dự kiến). */
  readonly analysis: TradeAttempt;
}

/**
 * Bảng On click (trong bộ nhớ app): kèo trader của từng profile KHÔNG tự vào vì giá bán thấp nhất
 * Polymarket ≥ ngưỡng, chờ người bấm vào lệnh. Trader gửi lại mỗi lần kèo được làm mới; gỡ khi kèo
 * bị hủy / đã vào / hết hạn. Mất khi app khởi động lại (trader gửi lại ở lần làm mới kế tiếp).
 */
export class OneClickBoard {
  private readonly _byProfile = new Map<
    string,
    Map<string, OneClickCandidate>
  >();

  constructor(private readonly _now: () => number = Date.now) {}

  apply(payload: unknown): void {
    const m = OneClickMessageSchema.parse(payload);
    if ('removed' in m) {
      this._byProfile.get(m.profileId)?.delete(m.signalId);
      return;
    }
    let p = this._byProfile.get(m.profileId);
    if (!p) {
      p = new Map<string, OneClickCandidate>();
      this._byProfile.set(m.profileId, p);
    }
    p.set(m.signalId, {
      profileId: m.profileId,
      signalId: m.signalId,
      expiresAt: m.expiresAt,
      updatedAt: this._now(),
      analysis: m.candidate,
    });
  }

  /** Kèo còn hiệu lực, mới cập nhật trước. */
  list(profileId: string): OneClickCandidate[] {
    const p = this._byProfile.get(profileId);
    if (!p) return [];
    const now = this._now();
    for (const [id, c] of p) if (c.expiresAt <= now) p.delete(id);
    return [...p.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(profileId: string, signalId: string): OneClickCandidate | null {
    const c = this._byProfile.get(profileId)?.get(signalId);
    return c && c.expiresAt > this._now() ? c : null;
  }
}
