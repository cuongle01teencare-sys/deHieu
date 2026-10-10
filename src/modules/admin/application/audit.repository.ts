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
}

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');
