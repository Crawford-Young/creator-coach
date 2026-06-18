import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
import type { PersonaProfile } from '@/lib/persona/schema'
import { creators } from './creator'

export const personaProfiles = pgTable('persona_profile', {
  id: uuid('id').defaultRandom().primaryKey(),
  creatorId: uuid('creator_id')
    .notNull()
    .references(() => creators.id, { onDelete: 'cascade' })
    .unique(),
  archetype: text('archetype').notNull(),
  timezone: text('timezone').notNull(),
  data: jsonb('data').$type<PersonaProfile>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
