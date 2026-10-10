import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { AuditEntry } from '../../domain/audit-entry.js';
import type { AuditQuery, AuditRepository } from '../audit.repository.js';

export class ListAuditHandler implements QueryHandler<
  AuditQuery,
  AuditEntry[]
> {
  constructor(private readonly _repo: AuditRepository) {}

  execute(q: AuditQuery) {
    return this._repo.list(q);
  }
}
