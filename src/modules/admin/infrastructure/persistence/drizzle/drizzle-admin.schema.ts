import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** Lịch sử sự cố vận hành (mức 1). */
export const drizzleOpsIncidentsTable = pgTable(
  'ops_incidents',
  {
    id: uuid('id').primaryKey(),
    key: text('key').notNull(),
    kind: text('kind').notNull(),
    severity: text('severity').notNull(), // warning | critical
    title: text('title').notNull(),
    message: text('message').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: text('acknowledged_by'),
  },
  (t) => [
    index('ops_incidents_opened_at_idx').on(t.openedAt),
    index('ops_incidents_key_idx').on(t.key),
    index('ops_incidents_resolved_at_idx').on(t.resolvedAt),
  ],
);

/** Audit các hành động thay đổi hệ thống qua API (mức 3). */
export const drizzleAuditLogTable = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    principalId: text('principal_id'),
    roles: jsonb('roles').$type<string[]>().notNull(),
    method: text('method').notNull(),
    route: text('route').notNull(),
    path: text('path').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull(),
    body: jsonb('body'),
    ok: boolean('ok').notNull(),
    status: integer('status').notNull(),
    error: text('error'),
    durationMs: integer('duration_ms').notNull(),
  },
  (t) => [
    index('audit_log_at_idx').on(t.at),
    index('audit_log_principal_idx').on(t.principalId),
  ],
);

/** Chuyển trạng thái dòng kèo (xuất hiện / open↔suspended / bị gỡ), giữ có thời hạn. */
export const drizzleOddsTransitionsTable = pgTable(
  'odds_transitions',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    room: text('room').notNull(),
    tenant: text('tenant').notNull(),
    phase: text('phase').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
  },
  (t) => [
    index('odds_transitions_at_idx').on(t.at),
    index('odds_transitions_room_idx').on(t.room, t.at),
  ],
);
