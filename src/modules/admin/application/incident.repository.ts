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
}

export const INCIDENT_REPOSITORY = Symbol('INCIDENT_REPOSITORY');
