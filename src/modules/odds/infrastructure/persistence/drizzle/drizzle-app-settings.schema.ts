import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Cấu hình app dạng key → JSON (vd 'arbitrage' → ArbitrageSettings). */
export const drizzleAppSettingsTable = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
