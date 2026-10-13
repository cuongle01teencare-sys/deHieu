/** Một trang kết quả: `total` = số bản ghi khớp bộ lọc (trước limit/offset). */
export interface Page<T> {
  readonly total: number;
  readonly items: readonly T[];
}
