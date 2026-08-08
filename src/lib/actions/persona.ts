'use server'

import { collections } from '@/db/mongo'
import { requireCreator } from '@/lib/tenant'
import { personaProfileSchema } from '@/lib/persona/schema'

export async function savePersonaProfile(input: unknown): Promise<{ ok: true }> {
  const creator = await requireCreator()
  const parsed = personaProfileSchema.parse(input)
  const now = new Date()
  await collections().personaProfiles.updateOne(
    { creatorId: creator.id },
    {
      $set: {
        archetype: parsed.identity.archetype,
        timezone: parsed.constraints.timezone,
        data: parsed,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )
  return { ok: true }
}
