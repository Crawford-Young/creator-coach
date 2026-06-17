import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './auth'

export const creators = pgTable('creator', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  platforms: text('platforms').array().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
