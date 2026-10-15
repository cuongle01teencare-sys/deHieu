import {
  and,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  like,
  lte,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { TransactionContext } from '../../../../../shared/infrastructure/database/transaction-context.js';
import type { OneClickCandidate } from '../../../application/one-click-board.js';
import type {
  OneClickHistoryEntry,
  OneClickHistoryQuery,
  OneClickHistoryRepository,
  OneClickPrior,
} from '../../../application/one-click-history.js';
import type { TradeAttempt } from '../../../application/trade-attempt.js';
import { drizzleOneClickHistoryTable as t } from './drizzle-trading.schema.js';

type Row = typeof t.$inferSelect;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const toEntry = (r: Row): OneClickHistoryEntry => ({
  profileId: r.profileId,
  signalId: r.signalId,
  room: r.room,
  sport: r.sport,
  market: r.market,
  phase: r.phase,
  comboId: r.comboId,
  teams: r.teams,
  signalMargin: r.signalMargin,
  tierName: r.tierName,
  minAsk: r.minAsk,
  threshold: r.threshold,
  analysis: r.analysis as unknown as TradeAttempt,
  updates: r.updates,
  firstAt: r.firstAt.getTime(),
  lastAt: r.lastAt.getTime(),
  expiresAt: r.expiresAt.getTime(),
  endedAt: r.endedAt?.getTime() ?? null,
  endReason: r.endReason,
  enteredBy: r.enteredBy,
});

export class DrizzleOneClickHistoryRepository implements OneClickHistoryRepository {
  constructor(private readonly _tx: TransactionContext) {}

  async upsert(c: OneClickCandidate): Promise<OneClickPrior> {
    const [prev] = await this._tx.executor
      .select({ endedAt: t.endedAt, endReason: t.endReason })
      .from(t)
      .where(and(eq(t.profileId, c.profileId), eq(t.signalId, c.signalId)));
    const a = c.analysis;
    const at = new Date(c.updatedAt);
    const v = {
      room: a.room,
      sport: a.sport,
      market: a.market,
      phase: a.phase,
      comboId: a.comboId,
      teams: [a.teams[0], a.teams[1]] as [string, string],
      signalMargin: a.signalMargin,
      tierName: a.tierName,
      minAsk: num(a.detail.minAsk),
      threshold: num(a.detail.oneClickMinPrice),
      analysis: a as unknown as Record<string, unknown>,
      lastAt: at,
      expiresAt: new Date(c.expiresAt),
    };
    await this._tx.executor
      .insert(t)
      .values({
        profileId: c.profileId,
        signalId: c.signalId,
        firstAt: at,
        updates: 1,
        ...v,
      })
      .onConflictDoUpdate({
        target: [t.profileId, t.signalId],
        // quay lại bảng sau khi đã rời (vd app khởi động lại, giá lên lại ngưỡng) → mở lại
        set: {
          ...v,
          updates: sql`${t.updates} + 1`,
          endedAt: null,
          endReason: null,
          enteredBy: null,
        },
      });
    if (!prev) return { state: 'none' };
    return prev.endedAt
      ? { state: 'ended', reason: prev.endReason }
      : { state: 'open' };
  }

  async end(
    profileId: string,
    signalId: string,
    reason: string,
    by: string | null,
    at: Date,
  ): Promise<void> {
    await this._tx.executor
      .update(t)
      .set({ endedAt: at, endReason: reason, enteredBy: by })
      .where(
        and(
          eq(t.profileId, profileId),
          eq(t.signalId, signalId),
          isNull(t.endedAt),
        ),
      );
  }

  async endAllOpen(reason: string, at: Date): Promise<number> {
    const rows = await this._tx.executor
      .update(t)
      .set({ endedAt: at, endReason: reason })
      .where(isNull(t.endedAt))
      .returning({ id: t.signalId });
    return rows.length;
  }

  private _where(q: OneClickHistoryQuery): SQL | undefined {
    const w: (SQL | undefined)[] = [];
    if (q.profileId) w.push(eq(t.profileId, q.profileId));
    if (q.from) w.push(gte(t.firstAt, q.from));
    if (q.to) w.push(lte(t.firstAt, q.to));
    const text = q.q?.trim().toLowerCase();
    if (text) {
      // thoát ký tự đặc biệt của LIKE (%, _, dấu gạch ngược)
      const esc = text.replace(/[\\%_]/g, (c) => `\\${c}`);
      w.push(
        sql`(lower(${t.signalId}) like ${`${esc}%`} or lower(${t.teams}::text) like ${`%${esc}%`} or lower(${t.room}) like ${`%${esc}%`})`,
      );
    }
    const manual = like(t.endReason, 'manual:%');
    const cancelled = like(t.endReason, 'cancelled:%');
    const expired = eq(t.endReason, 'expired');
    const auto = like(t.endReason, 'result:paper_filled%');
    switch (q.outcome) {
      case 'open':
        w.push(isNull(t.endedAt));
        break;
      case 'manual':
        w.push(manual);
        break;
      case 'cancelled':
        w.push(cancelled);
        break;
      case 'expired':
        w.push(expired);
        break;
      case 'auto':
        w.push(auto);
        break;
      case 'other':
        w.push(
          isNotNull(t.endedAt),
          not(or(manual, cancelled, expired, auto)!),
        );
        break;
      default:
        break;
    }
    const all = w.filter((x): x is SQL => !!x);
    return all.length ? and(...all) : undefined;
  }

  async list(
    q: OneClickHistoryQuery,
  ): Promise<{ total: number; items: OneClickHistoryEntry[] }> {
    const where = this._where(q);
    const [rows, [c]] = await Promise.all([
      this._tx.executor
        .select()
        .from(t)
        .where(where)
        .orderBy(desc(t.firstAt))
        .limit(q.limit)
        .offset(q.offset),
      this._tx.executor
        .select({ n: sql<number>`count(*)::int` })
        .from(t)
        .where(where),
    ]);
    return { total: c?.n ?? 0, items: rows.map(toEntry) };
  }
}
