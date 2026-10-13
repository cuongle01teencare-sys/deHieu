import { and, desc, eq, gte, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { TransactionContext } from '../../../../../shared/infrastructure/database/transaction-context.js';
import type {
  OddsTransitionQuery,
  OddsTransitionRepository,
} from '../../../application/odds-transition.repository.js';
import type { OddsTransition } from '../../../domain/odds-transition.js';
import { drizzleOddsTransitionsTable as t } from './drizzle-admin.schema.js';

export class DrizzleOddsTransitionRepository implements OddsTransitionRepository {
  constructor(private readonly _tx: TransactionContext) {}

  async insertMany(entries: readonly OddsTransition[]): Promise<void> {
    if (!entries.length) return;
    await this._tx.executor.insert(t).values(
      entries.map((e) => ({
        at: new Date(e.at),
        room: e.room,
        tenant: e.tenant,
        phase: e.phase,
        fromStatus: e.from,
        toStatus: e.to,
        reason: e.reason,
      })),
    );
  }

  async count(q: OddsTransitionQuery): Promise<number> {
    const [row] = await this._tx.executor
      .select({ n: sql<number>`count(*)::int` })
      .from(t)
      .where(this._where(q));
    return row?.n ?? 0;
  }

  private _where(q: OddsTransitionQuery): SQL | undefined {
    const where: SQL[] = [];
    if (q.room) where.push(eq(t.room, q.room));
    if (q.tenant) where.push(eq(t.tenant, q.tenant));
    if (q.to) where.push(eq(t.toStatus, q.to));
    if (q.from) where.push(gte(t.at, q.from));
    if (q.until) where.push(lte(t.at, q.until));
    return where.length ? and(...where) : undefined;
  }

  async list(q: OddsTransitionQuery): Promise<OddsTransition[]> {
    const where = this._where(q);
    const rows = await this._tx.executor
      .select()
      .from(t)
      .where(where)
      .orderBy(desc(t.at), desc(t.id))
      .limit(q.limit)
      .offset(q.offset);
    return rows.map((r) => ({
      at: r.at.getTime(),
      room: r.room,
      tenant: r.tenant,
      phase: r.phase,
      from: r.fromStatus,
      to: r.toStatus,
      reason: r.reason,
    }));
  }

  async deleteOlderThan(before: Date): Promise<number> {
    const rows = await this._tx.executor
      .delete(t)
      .where(lt(t.at, before))
      .returning({ id: t.id });
    return rows.length;
  }
}
