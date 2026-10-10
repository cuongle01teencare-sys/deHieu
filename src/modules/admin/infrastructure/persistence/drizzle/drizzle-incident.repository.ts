import { and, desc, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import type { TransactionContext } from '../../../../../shared/infrastructure/database/transaction-context.js';
import type {
  IncidentQuery,
  IncidentRepository,
} from '../../../application/incident.repository.js';
import type { Incident, IncidentSeverity } from '../../../domain/incident.js';
import { drizzleOpsIncidentsTable as t } from './drizzle-admin.schema.js';

const d = (ms: number | null) => (ms === null ? null : new Date(ms));
const ms = (x: Date | null) => (x === null ? null : x.getTime());

export class DrizzleIncidentRepository implements IncidentRepository {
  constructor(private readonly _tx: TransactionContext) {}

  async save(i: Incident): Promise<void> {
    const update = {
      kind: i.kind,
      severity: i.severity,
      title: i.title,
      message: i.message,
      details: { ...i.details },
      openedAt: new Date(i.openedAt),
      lastSeenAt: new Date(i.lastSeenAt),
      resolvedAt: d(i.resolvedAt),
      resolution: i.resolution,
      acknowledgedAt: d(i.acknowledgedAt),
      acknowledgedBy: i.acknowledgedBy,
    };
    await this._tx.executor
      .insert(t)
      .values({ id: i.id, key: i.key, ...update })
      .onConflictDoUpdate({ target: t.id, set: update });
  }

  async closeAllOpen(at: number, resolution: string): Promise<number> {
    const rows = await this._tx.executor
      .update(t)
      .set({ resolvedAt: new Date(at), resolution })
      .where(isNull(t.resolvedAt))
      .returning({ id: t.id });
    return rows.length;
  }

  async list(q: IncidentQuery): Promise<Incident[]> {
    const where: SQL[] = [];
    if (q.open === true) where.push(isNull(t.resolvedAt));
    if (q.open === false) where.push(isNotNull(t.resolvedAt));
    if (q.kind) where.push(eq(t.kind, q.kind));
    const rows = await this._tx.executor
      .select()
      .from(t)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(t.openedAt))
      .limit(q.limit)
      .offset(q.offset);
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      kind: r.kind,
      severity: r.severity as IncidentSeverity,
      title: r.title,
      message: r.message,
      details: r.details,
      openedAt: r.openedAt.getTime(),
      lastSeenAt: r.lastSeenAt.getTime(),
      resolvedAt: ms(r.resolvedAt),
      resolution: r.resolution,
      acknowledgedAt: ms(r.acknowledgedAt),
      acknowledgedBy: r.acknowledgedBy,
    }));
  }
}
