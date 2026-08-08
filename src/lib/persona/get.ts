import { collections } from '@/db'
import { requireCreator } from '@/lib/tenant'
import { personaProfileSchema, type PersonaProfile } from '@/lib/persona/schema'

export async function getPersonaProfile(): Promise<PersonaProfile | null> {
  const creator = await requireCreator()
  const row = await collections().personaProfiles.findOne({ creatorId: creator.id })
  if (!row) return null
  return personaProfileSchema.parse(row.data)
}
