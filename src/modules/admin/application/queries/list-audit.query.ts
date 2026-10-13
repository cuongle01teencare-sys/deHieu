import type { Page } from '../../../../shared/application/page.js';
import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { AuditEntry } from '../../domain/audit-entry.js';
import type { AuditQuery, AuditRepository } from '../audit.repository.js';

export class ListAuditHandler implements QueryHandler<
  AuditQuery,
  Page<AuditEntry>
> {
  constructor(private readonly _repo: AuditRepository) {}

  async execute(q: AuditQuery): Promise<Page<AuditEntry>> {
    const [items, total] = await Promise.all([
      this._repo.list(q),
      this._repo.count(q),
    ]);
    return { total, items };
  }
}
