/** Giờ bắt đầu trận theo một tenant (ms). */
export interface LegStartTime {
  readonly tenant: string;
  readonly startsAt: number;
}

/**
 * Ảnh chụp lúc một kèo bị hủy, để admin thấy vì sao (nhất là `start_time_mismatch`):
 * giờ bắt đầu của từng chân còn trong room, độ lệch giữa hai chân và ngưỡng đang áp.
 */
export interface SignalCloseDetail {
  /** Chân đã bị gỡ khỏi room thì không có ở đây. */
  readonly startTimes: readonly LegStartTime[];
  /** |giờ chân 1 − giờ chân 2| (ms); null khi thiếu một chân. */
  readonly startDriftMs: number | null;
  /** Ngưỡng lệch giờ tối đa lúc hủy (ms). */
  readonly maxStartDriftMs: number;
}
