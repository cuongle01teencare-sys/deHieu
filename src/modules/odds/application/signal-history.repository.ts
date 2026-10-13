import type { Phase } from '../domain/phase.js';
import type {
  SignalHistoryEntry,
  SignalStatus,
} from '../domain/signal-history.js';

export interface SignalHistoryQuery {
  readonly status?: SignalStatus;
  readonly phase?: Phase;
  readonly room?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

/** Port: lưu lịch sử kèo (Postgres). */
export interface SignalHistoryRepository {
  insert(entry: SignalHistoryEntry): Promise<void>;
  markRefreshed(signalId: string, expiresAt: Date, at: Date): Promise<void>;
  close(
    signalId: string,
    status: Exclude<SignalStatus, 'active'>,
    reason: string | null,
    at: Date,
    supersededBy?: string,
  ): Promise<void>;
  /** Đóng mọi kèo còn 'active' (dùng khi app khởi động lại). Trả về số kèo bị đóng. */
  abandonActive(reason: string, at: Date): Promise<number>;
  list(query: SignalHistoryQuery): Promise<SignalHistoryEntry[]>;
  /** Số bản ghi khớp bộ lọc (bỏ qua limit/offset) — cho phân trang. */
  count(query: SignalHistoryQuery): Promise<number>;
  get(signalId: string): Promise<SignalHistoryEntry | null>;
  /**
   * Xóa tối đa `limit` kèo ĐÃ KẾT THÚC (không phải active) phát hơn `before` (chính sách giữ lại). Trả về số đã xóa;
   * gọi lặp tới khi < limit để không khóa bảng lâu.
   */
  purgeOlderThan(before: Date, limit: number): Promise<number>;
}

export const SIGNAL_HISTORY_REPOSITORY = Symbol('SIGNAL_HISTORY_REPOSITORY');
