import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { SignalCloseDetail } from '../../../domain/signal-close-detail.js';

/** Lịch sử mọi kèo app đã phát và tình trạng hiện tại của từng kèo. */
export const drizzleArbitrageSignalsTable = pgTable(
  'arbitrage_signals',
  {
    signalId: text('signal_id').primaryKey(),
    room: text('room').notNull(),
    sport: text('sport').notNull(),
    market: text('market').notNull(),
    phase: text('phase').notNull(), // live | prematch
    comboId: text('combo_id').notNull(),
    teams: jsonb('teams').$type<[string, string]>().notNull(),
    margin: doublePrecision('margin').notNull(),
    legs: jsonb('legs').$type<unknown[]>().notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    refreshCount: integer('refresh_count').default(0).notNull(),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
    status: text('status').notNull(), // active | superseded | cancelled | abandoned
    statusReason: text('status_reason'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    supersededBy: text('superseded_by'),
    /** Ảnh chụp lúc hủy: giờ bắt đầu từng chân, độ lệch, ngưỡng (xem SignalCloseDetail). */
    closeDetail: jsonb('close_detail').$type<SignalCloseDetail>(),
  },
  (t) => [
    index('arbitrage_signals_issued_at_idx').on(t.issuedAt),
    index('arbitrage_signals_status_idx').on(t.status),
    index('arbitrage_signals_room_idx').on(t.room),
  ],
);
