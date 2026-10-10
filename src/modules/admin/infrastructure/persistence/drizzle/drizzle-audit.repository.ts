import { and, desc, eq, gte, ilike, lte, type SQL } from 'drizzle-orm';
import type { TransactionContext } from '../../../../../shared/infrastructure/database/transaction-context.js';
import type {
  AuditQuery,
  AuditRepository,
} from '../../../application/audit.repository.js';
import type { AuditEntry } from '../../../domain/audit-entry.js';
import { drizzleAuditLogTable as t } from './drizzle-admin.schema.js';

export class DrizzleAuditRepository implements AuditRepository {
  constructor(private readonly _tx: TransactionContext) {}

  async insert(e: AuditEntry): Promise<void> {
    await this._tx.executor
      .insert(t)
      .values({
        id: e.id,
        at: new Date(e.at),
        principalId: e.principalId,
        roles: [...e.roles],
        method: e.method,
        route: e.route,
        path: e.path,
        params: { ...e.params },
        body: e.body ?? null,
        ok: e.ok,
        status: e.status,
        error: e.error,
        durationMs: e.durationMs,
      })
      .onConflictDoNothing();
  }

  async list(q: AuditQuery): Promise<AuditEntry[]> {
    const where: SQL[] = [];
    if (q.principalId) where.push(eq(t.principalId, q.principalId));
    if (q.method) where.push(eq(t.method, q.method.toUpperCase()));
    if (q.route) where.push(ilike(t.route, `%${q.route}%`));
    if (q.from) where.push(gte(t.at, q.from));
    if (q.to) where.push(lte(t.at, q.to));
    const rows = await this._tx.executor
      .select()
      .from(t)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(t.at))
      .limit(q.limit)
      .offset(q.offset);
    return rows.map((r) => ({ ...r, at: r.at.getTime(), body: r.body }));
  }
}
