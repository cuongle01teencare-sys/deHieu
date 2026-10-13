import type { Incident } from '../domain/incident.js';

export interface IncidentQuery {
  readonly open?: boolean;
  readonly kind?: string;
  readonly limit: number;
  readonly offset: number;
}

/** Port: lưu lịch sử sự cố (mở/đóng/xác nhận). */
export interface IncidentRepository {
  save(incident: Incident): Promise<void>;
  /** Đóng mọi sự cố còn mở (vd khi app khởi động lại: trạng thái trong RAM đã mất). */
  closeAllOpen(at: number, resolution: string): Promise<number>;
  list(q: IncidentQuery): Promise<Incident[]>;
  /** Số bản ghi khớp bộ lọc (bỏ qua limit/offset) — cho phân trang. */
  count(q: IncidentQuery): Promise<number>;
  /**
   * Xóa tối đa `limit` sự cố ĐÃ ĐÓNG có resolvedAt hơn `before` (chính sách giữ lại). Trả về số đã xóa;
   * gọi lặp tới khi < limit để không khóa bảng lâu.
   */
  purgeOlderThan(before: Date, limit: number): Promise<number>;
}

export const INCIDENT_REPOSITORY = Symbol('INCIDENT_REPOSITORY');
