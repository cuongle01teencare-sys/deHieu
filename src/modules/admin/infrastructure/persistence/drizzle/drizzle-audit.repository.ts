import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
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

  async count(q: AuditQuery): Promise<number> {
    const [row] = await this._tx.executor
      .select({ n: sql<number>`count(*)::int` })
      .from(t)
      .where(this._where(q));
    return row?.n ?? 0;
  }

  private _where(q: AuditQuery): SQL | undefined {
    const where: SQL[] = [];
    if (q.principalId) where.push(eq(t.principalId, q.principalId));
    if (q.method) where.push(eq(t.method, q.method.toUpperCase()));
    if (q.route) where.push(ilike(t.route, `%${q.route}%`));
    if (q.from) where.push(gte(t.at, q.from));
    if (q.to) where.push(lte(t.at, q.to));
    return where.length ? and(...where) : undefined;
  }

  async list(q: AuditQuery): Promise<AuditEntry[]> {
    const where = this._where(q);
    const rows = await this._tx.executor
      .select()
      .from(t)
      .where(where)
      .orderBy(desc(t.at))
      .limit(q.limit)
      .offset(q.offset);
    return rows.map((r) => ({ ...r, at: r.at.getTime(), body: r.body }));
  }

  /** Theo lô bằng subquery (Postgres không có DELETE ... LIMIT). */
  async purgeOlderThan(before: Date, limit: number): Promise<number> {
    const db = this._tx.executor;
    const ids = db
      .select({ id: t.id })
      .from(t)
      .where(lt(t.at, before))
      .limit(limit);
    const rows = await db
      .delete(t)
      .where(inArray(t.id, ids))
      .returning({ id: t.id });
    return rows.length;
  }
}
