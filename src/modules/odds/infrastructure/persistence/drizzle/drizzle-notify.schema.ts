import {
  boolean,
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Hạng kèo do admin đặt tên (vd "VIP" ≥ 5%). */
export const drizzleSignalTiersTable = pgTable(
  'signal_tiers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    minMargin: doublePrecision('min_margin').notNull(),
    maxMargin: doublePrecision('max_margin'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('signal_tiers_name_uq').on(t.name)],
);

/** Kênh nhận kèo: Discord webhook / Telegram bot / Slack webhook. */
export const drizzleNotifyChannelsTable = pgTable('notify_channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  /** webhookUrl hoặc { botToken, chatId } — chứa bí mật, API không trả ra nguyên văn. */
  config: jsonb('config').$type<Record<string, string>>().notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  tierIds: jsonb('tier_ids').$type<string[]>().default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
