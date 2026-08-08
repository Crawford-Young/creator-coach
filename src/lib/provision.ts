import { ObjectId } from 'mongodb'
import { collections, toCreator, type Creator, type CreatorDoc } from '@/db/mongo'

const DEFAULT_DISPLAY_NAME = 'Creator'
const TWITCH_PLATFORM = 'twitch'

export async function provisionCreator(userId: string, displayName: string): Promise<Creator> {
  const { creators } = collections()
  const existing = await creators.findOne({ userId })
  if (existing) return toCreator(existing)
  const doc: CreatorDoc = {
    _id: new ObjectId(),
    userId,
    displayName: displayName || DEFAULT_DISPLAY_NAME,
    timezone: 'UTC',
    platforms: [TWITCH_PLATFORM],
    createdAt: new Date(),
  }
  await creators.insertOne(doc)
  return toCreator(doc)
}
