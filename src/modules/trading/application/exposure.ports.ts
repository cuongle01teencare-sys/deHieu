/**
 * Sổ phơi nhiễm THẬT mà task trader dùng để quyết định (Redis, namespace của chế độ giấy):
 * tiền đã dùng theo trận và số lệnh đã vào theo cửa. Khác thống kê ở Lệnh giấy (tính từ lịch sử
 * lệnh trong DB): xóa lệnh không làm sổ này đổi.
 */
export interface MatchUsage {
  /** `cs2:a~b` — gộp mọi market của trận. */
  readonly match: string;
  /** Đã dùng chung mọi trader (USD, cả hai chân); null = chưa có khóa chung. */
  readonly usedUsd: number | null;
  readonly ttlMs: number | null;
  /** Đã dùng riêng từng profile (giới hạn riêng của profile). */
  readonly byProfile: readonly {
    readonly profileId: string;
    readonly usedUsd: number;
    readonly ttlMs: number | null;
  }[];
}

export interface EntryUsage {
  readonly profileId: string;
  /** `room:cs2:a~b:game-winner`. */
  readonly room: string;
  readonly comboId: string;
  readonly tierId: string;
  /** Số lệnh đã vào ở cửa + hạng này. */
  readonly count: number;
  readonly ttlMs: number | null;
}

export interface ExposureSnapshot {
  readonly matches: readonly MatchUsage[];
  readonly entries: readonly EntryUsage[];
}

export interface EntryRef {
  readonly profileId: string;
  readonly room: string;
  readonly comboId: string;
  readonly tierId: string;
}

export interface ExposureLedgerReader {
  /** Ném lỗi khi không đọc được (Redis không chạy...). */
  snapshot(): Promise<ExposureSnapshot>;
  /** Xóa mọi khóa tiền của trận (chung + riêng từng profile). Trả số khóa đã xóa. */
  resetMatch(match: string): Promise<number>;
  /** Xóa bộ đếm số lệnh của một cửa + hạng. */
  resetEntry(e: EntryRef): Promise<number>;
}
export const EXPOSURE_LEDGER_READER = Symbol('EXPOSURE_LEDGER_READER');
