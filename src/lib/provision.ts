import { collections, toCreator, type Creator } from '@/db'

const DEFAULT_DISPLAY_NAME = 'Creator'
const TWITCH_PLATFORM = 'twitch'

export async function provisionCreator(userId: string, displayName: string): Promise<Creator> {
  const { creators } = collections()
  // Atomic upsert — a check-then-insert (findOne then insertOne) races
  // under concurrent calls for the same userId and throws E11000 on the
  // unique index. $setOnInsert applies only when the upsert inserts a new
  // document, so an existing creator's platforms array (mutated later via
  // $addToSet at platform-link time) is never touched by re-provisioning.
  const doc = await creators.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        userId,
        displayName: displayName || DEFAULT_DISPLAY_NAME,
        timezone: 'UTC',
        platforms: [TWITCH_PLATFORM],
        createdAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after' },
  )
  if (!doc) {
    // upsert: true guarantees a matched-or-inserted document; findOneAndUpdate's
    // return type is nullable only for the non-upsert case.
    throw new Error(`provisionCreator: findOneAndUpdate returned no document for userId ${userId}`)
  }
  return toCreator(doc)
}
