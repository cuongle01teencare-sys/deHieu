import type { TradeAttempt } from './trade-attempt.js';
import type { OneClickCandidate, OneClickEvent } from './one-click-board.js';

/**
 * Kết quả của một kèo On click (suy từ lý do rời bảng):
 *  open      : đang chờ trên bảng
 *  manual    : người bấm vào lệnh (enteredBy; kết quả trong endReason)
 *  cancelled : publisher hủy kèo (endReason = cancelled:<lý do hủy>)
 *  expired   : hết hạn, không được làm mới
 *  auto      : bot tự vào (giá bán thấp nhất xuống dưới ngưỡng)
 *  other     : bot xét lại ra kết quả khác (hết lãi, sổ mỏng…), app khởi động lại
 */
export const ONE_CLICK_OUTCOMES = [
  'open',
  'manual',
  'cancelled',
  'expired',
  'auto',
  'other',
] as const;
export type OneClickOutcome = (typeof ONE_CLICK_OUTCOMES)[number];

export interface OneClickHistoryEntry {
  readonly profileId: string;
  readonly signalId: string;
  readonly room: string;
  readonly sport: string;
  readonly market: string;
  readonly phase: string;
  readonly comboId: string;
  readonly teams: readonly [string, string];
  readonly signalMargin: number;
  readonly tierName: string | null;
  /** Giá bán thấp nhất Polymarket ở lần cập nhật gần nhất. */
  readonly minAsk: number | null;
  /** Ngưỡng On click của profile lúc đó. */
  readonly threshold: number | null;
  /** Phân tích "nếu vào bây giờ" gần nhất. */
  readonly analysis: TradeAttempt;
  /** Số lần trader gửi phân tích (lên bảng + mỗi lần làm mới). */
  readonly updates: number;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly expiresAt: number;
  readonly endedAt: number | null;
  readonly endReason: string | null;
  readonly enteredBy: string | null;
}

export interface OneClickHistoryQuery {
  readonly profileId?: string;
  /** Mã kèo (phần đầu) hoặc tên đội / room. */
  readonly q?: string;
  readonly outcome?: OneClickOutcome;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

/** Port: lịch sử On click (Postgres) — mỗi profile × kèo một dòng. */
export interface OneClickHistoryRepository {
  /** Lên bảng / cập nhật phân tích; kèo đã rời bảng mà quay lại thì mở lại. */
  upsert(c: OneClickCandidate): Promise<void>;
  /** Rời bảng (chỉ dòng đang mở). */
  end(
    profileId: string,
    signalId: string,
    reason: string,
    by: string | null,
    at: Date,
  ): Promise<void>;
  /** Đóng mọi dòng đang mở (app khởi động lại: bảng trong bộ nhớ đã mất). */
  endAllOpen(reason: string, at: Date): Promise<number>;
  list(
    q: OneClickHistoryQuery,
  ): Promise<{ total: number; items: OneClickHistoryEntry[] }>;
}

export const ONE_CLICK_HISTORY_REPOSITORY = Symbol(
  'ONE_CLICK_HISTORY_REPOSITORY',
);

/** Ghi thay đổi của bảng On click vào lịch sử. */
export class OneClickHistoryRecorder {
  constructor(private readonly _repo: OneClickHistoryRepository) {}

  async record(e: OneClickEvent): Promise<void> {
    if (e.type === 'upsert') return this._repo.upsert(e.candidate);
    return this._repo.end(
      e.profileId,
      e.signalId,
      e.reason,
      e.by,
      new Date(e.at),
    );
  }

  list(q: OneClickHistoryQuery) {
    return this._repo.list(q);
  }

  closeOpen(reason: string): Promise<number> {
    return this._repo.endAllOpen(reason, new Date());
  }
}
