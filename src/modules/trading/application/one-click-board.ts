import { z } from 'zod';
import { TradeAttemptSchema, type TradeAttempt } from './trade-attempt.js';

/** Payload kênh 'oneclick' của task trader. */
const OneClickMessageSchema = z.union([
  z.object({
    profileId: z.string().min(1),
    signalId: z.string().min(1),
    removed: z.literal(true),
    /** Vì sao rời bảng: cancelled:<lý do hủy> | manual:<kết quả> | result:<kết quả>. */
    reason: z.string().max(300).optional(),
    /** Người bấm vào lệnh (manual). */
    by: z.string().max(200).optional(),
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

/** Thay đổi trên bảng, để ghi lịch sử On click. */
export type OneClickEvent =
  | { readonly type: 'upsert'; readonly candidate: OneClickCandidate }
  | {
      readonly type: 'end';
      readonly profileId: string;
      readonly signalId: string;
      readonly reason: string;
      readonly by: string | null;
      readonly at: number;
    };

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

  apply(payload: unknown): OneClickEvent {
    const m = OneClickMessageSchema.parse(payload);
    if ('removed' in m) {
      this._byProfile.get(m.profileId)?.delete(m.signalId);
      return {
        type: 'end',
        profileId: m.profileId,
        signalId: m.signalId,
        reason: m.reason ?? 'removed',
        by: m.by ?? null,
        at: this._now(),
      };
    }
    let p = this._byProfile.get(m.profileId);
    if (!p) {
      p = new Map<string, OneClickCandidate>();
      this._byProfile.set(m.profileId, p);
    }
    const candidate: OneClickCandidate = {
      profileId: m.profileId,
      signalId: m.signalId,
      expiresAt: m.expiresAt,
      updatedAt: this._now(),
      analysis: m.candidate,
    };
    p.set(m.signalId, candidate);
    return { type: 'upsert', candidate };
  }

  /** Gỡ kèo đã hết hạn (không được làm mới); trả về để ghi lịch sử. */
  sweep(): OneClickEvent[] {
    const now = this._now();
    const out: OneClickEvent[] = [];
    for (const p of this._byProfile.values())
      for (const [id, c] of p)
        if (c.expiresAt <= now) {
          p.delete(id);
          out.push({
            type: 'end',
            profileId: c.profileId,
            signalId: id,
            reason: 'expired',
            by: null,
            at: now,
          });
        }
    return out;
  }

  /** Kèo còn hiệu lực, mới cập nhật trước. */
  list(profileId: string): OneClickCandidate[] {
    const p = this._byProfile.get(profileId);
    if (!p) return [];
    const now = this._now();
    return [...p.values()]
      .filter((c) => c.expiresAt > now)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(profileId: string, signalId: string): OneClickCandidate | null {
    const c = this._byProfile.get(profileId)?.get(signalId);
    return c && c.expiresAt > this._now() ? c : null;
  }
}
