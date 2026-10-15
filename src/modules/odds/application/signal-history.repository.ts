import type { Phase } from '../domain/phase.js';
import type {
  SignalHistoryEntry,
  SignalStatus,
} from '../domain/signal-history.js';
import type { SignalCloseDetail } from '../domain/signal-close-detail.js';

export interface SignalHistoryQuery {
  readonly status?: SignalStatus;
  readonly phase?: Phase;
  readonly room?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

/** Lọc khi xóa tay: chỉ kèo đã kết thúc. */
export interface SignalHistoryPurgeFilter {
  /** Trạng thái được xóa; bỏ trống = mọi trạng thái đã kết thúc. */
  readonly statuses?: readonly Exclude<SignalStatus, 'active'>[];
  /** Kèo phát trước thời điểm này. */
  readonly before: Date;
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
    detail?: SignalCloseDetail | null,
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
  /** Đếm kèo sẽ bị xóa tay (đã kết thúc, khớp lọc). */
  countPurgeable(f: SignalHistoryPurgeFilter): Promise<number>;
  /** Xóa tay tối đa `limit` kèo đã kết thúc khớp lọc; gọi lặp tới khi < limit. */
  purge(f: SignalHistoryPurgeFilter, limit: number): Promise<number>;
  /** Xóa một kèo. ACTIVE = kèo còn sống, không xóa. */
  deleteOne(signalId: string): Promise<'DELETED' | 'NOT_FOUND' | 'ACTIVE'>;
}

export const SIGNAL_HISTORY_REPOSITORY = Symbol('SIGNAL_HISTORY_REPOSITORY');
