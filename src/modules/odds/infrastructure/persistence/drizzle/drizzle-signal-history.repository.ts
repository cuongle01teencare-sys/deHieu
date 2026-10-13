import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { TransactionContext } from '../../../../../shared/infrastructure/database/transaction-context.js';
import type {
  SignalHistoryQuery,
  SignalHistoryRepository,
} from '../../../application/signal-history.repository.js';
import type { ArbitrageLeg } from '../../../domain/arbitrage-opportunity.js';
import type { Phase } from '../../../domain/phase.js';
import type {
  SignalHistoryEntry,
  SignalStatus,
} from '../../../domain/signal-history.js';
import { drizzleArbitrageSignalsTable as t } from './drizzle-arbitrage-signal.schema.js';

type Row = typeof t.$inferSelect;

const toEntry = (r: Row): SignalHistoryEntry => ({
  ...r,
  phase: r.phase as Phase,
  status: r.status as SignalStatus,
  legs: r.legs as unknown as [ArbitrageLeg, ArbitrageLeg],
});

/** Ghi/đọc lịch sử kèo. Lỗi DB được ném ra để recorder (chạy nền) ghi log. */
export class DrizzleSignalHistoryRepository implements SignalHistoryRepository {
  constructor(private readonly _tx: TransactionContext) {}

  async insert(e: SignalHistoryEntry): Promise<void> {
    await this._tx.executor
      .insert(t)
      .values({
        ...e,
        teams: [...e.teams] as [string, string],
        legs: [...e.legs],
      })
      .onConflictDoNothing();
  }

  async markRefreshed(
    signalId: string,
    expiresAt: Date,
    at: Date,
  ): Promise<void> {
    await this._tx.executor
      .update(t)
      .set({
        expiresAt,
        lastRefreshedAt: at,
        refreshCount: sql`${t.refreshCount} + 1`,
      })
      .where(and(eq(t.signalId, signalId), eq(t.status, 'active')));
  }

  async close(
    signalId: string,
    status: Exclude<SignalStatus, 'active'>,
    reason: string | null,
    at: Date,
    supersededBy?: string,
  ): Promise<void> {
    await this._tx.executor
      .update(t)
      .set({
        status,
        statusReason: reason,
        closedAt: at,
        supersededBy: supersededBy ?? null,
      })
      .where(and(eq(t.signalId, signalId), eq(t.status, 'active')));
  }

  async abandonActive(reason: string, at: Date): Promise<number> {
    const rows = await this._tx.executor
      .update(t)
      .set({ status: 'abandoned', statusReason: reason, closedAt: at })
      .where(eq(t.status, 'active'))
      .returning({ id: t.signalId });
    return rows.length;
  }

  async count(q: SignalHistoryQuery): Promise<number> {
    const [row] = await this._tx.executor
      .select({ n: sql<number>`count(*)::int` })
      .from(t)
      .where(this._where(q));
    return row?.n ?? 0;
  }

  private _where(q: SignalHistoryQuery): SQL | undefined {
    const where: SQL[] = [];
    if (q.status) where.push(eq(t.status, q.status));
    if (q.phase) where.push(eq(t.phase, q.phase));
    if (q.room) where.push(eq(t.room, q.room));
    if (q.from) where.push(gte(t.issuedAt, q.from));
    if (q.to) where.push(lte(t.issuedAt, q.to));
    return where.length ? and(...where) : undefined;
  }

  async list(q: SignalHistoryQuery): Promise<SignalHistoryEntry[]> {
    const where = this._where(q);
    const rows = await this._tx.executor
      .select()
      .from(t)
      .where(where)
      .orderBy(desc(t.issuedAt))
      .limit(q.limit)
      .offset(q.offset);
    return rows.map(toEntry);
  }

  async get(signalId: string): Promise<SignalHistoryEntry | null> {
    const [row] = await this._tx.executor
      .select()
      .from(t)
      .where(eq(t.signalId, signalId));
    return row ? toEntry(row) : null;
  }

  /** Chỉ kèo đã kết thúc (khác 'active'); theo lô bằng subquery. */
  async purgeOlderThan(before: Date, limit: number): Promise<number> {
    const db = this._tx.executor;
    const ids = db
      .select({ id: t.signalId })
      .from(t)
      .where(and(ne(t.status, 'active'), lt(t.issuedAt, before)))
      .limit(limit);
    const rows = await db
      .delete(t)
      .where(inArray(t.signalId, ids))
      .returning({ id: t.signalId });
    return rows.length;
  }
}
