'use server'

import { db } from '@/db'
import { personaProfiles } from '@/db/schema'
import { requireCreator } from '@/lib/tenant'
import { personaProfileSchema } from '@/lib/persona/schema'

export async function savePersonaProfile(input: unknown): Promise<{ ok: true }> {
  const creator = await requireCreator()
  const parsed = personaProfileSchema.parse(input)
  await db
    .insert(personaProfiles)
    .values({
      creatorId: creator.id,
      archetype: parsed.identity.archetype,
      timezone: parsed.constraints.timezone,
      data: parsed,
    })
    .onConflictDoUpdate({
      target: personaProfiles.creatorId,
      set: {
        archetype: parsed.identity.archetype,
        timezone: parsed.constraints.timezone,
        data: parsed,
        updatedAt: new Date(),
      },
    })
  return { ok: true }
}
