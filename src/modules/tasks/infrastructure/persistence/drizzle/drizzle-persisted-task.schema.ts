import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Task có persist = true: tự chạy lại sau khi app khởi động (desired = 'running'). */
export const drizzlePersistedTasksTable = pgTable('persisted_tasks', {
  taskId: text('task_id').primaryKey(),
  kind: text('kind').notNull(),
  tenant: text('tenant').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull(),
  runtime: jsonb('runtime').notNull(),
  desired: text('desired').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
