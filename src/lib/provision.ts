import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { creators } from '@/db/schema'

const DEFAULT_DISPLAY_NAME = 'Creator'
const TWITCH_PLATFORM = 'twitch'

export async function provisionCreator(
  userId: string,
  displayName: string,
): Promise<typeof creators.$inferSelect> {
  const existing = await db.select().from(creators).where(eq(creators.userId, userId)).limit(1)
  if (existing[0]) return existing[0]
  const [created] = await db
    .insert(creators)
    .values({
      userId,
      displayName: displayName || DEFAULT_DISPLAY_NAME,
      platforms: [TWITCH_PLATFORM],
    })
    .returning()
  return created
}
