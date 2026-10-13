import type { AuditEntry } from '../domain/audit-entry.js';

export interface AuditQuery {
  readonly principalId?: string;
  readonly method?: string;
  /** Lọc theo route chứa chuỗi này, vd 'tasks'. */
  readonly route?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

export interface AuditRepository {
  insert(entry: AuditEntry): Promise<void>;
  list(q: AuditQuery): Promise<AuditEntry[]>;
  /** Số bản ghi khớp bộ lọc (bỏ qua limit/offset) — cho phân trang. */
  count(q: AuditQuery): Promise<number>;
  /**
   * Xóa tối đa `limit` bản ghi cũ hơn `before` (chính sách giữ lại). Trả về số đã xóa;
   * gọi lặp tới khi < limit để không khóa bảng lâu.
   */
  purgeOlderThan(before: Date, limit: number): Promise<number>;
}

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');
