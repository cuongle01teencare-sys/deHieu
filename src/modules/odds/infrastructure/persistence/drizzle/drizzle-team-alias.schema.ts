import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const drizzleTeamAliasesTable = pgTable(
  'team_aliases',
  {
    id: text('id').primaryKey(),
    alias: text('alias').notNull(),
    canonical: text('canonical').notNull(),
    version: integer('version').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('team_aliases_alias_uq').on(t.alias)],
);
