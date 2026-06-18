import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { personaProfiles } from '@/db/schema'
import { requireCreator } from '@/lib/tenant'
import { personaProfileSchema, type PersonaProfile } from '@/lib/persona/schema'

export async function getPersonaProfile(): Promise<PersonaProfile | null> {
  const creator = await requireCreator()
  const [row] = await db
    .select()
    .from(personaProfiles)
    .where(eq(personaProfiles.creatorId, creator.id))
    .limit(1)
  if (!row) return null
  return personaProfileSchema.parse(row.data)
}
