import { MongoClient, type Db, type Collection, type ObjectId } from 'mongodb'
import { env } from '@/env'
import type { PersonaProfile } from '@/lib/persona/schema'

export interface CreatorDoc {
  _id: ObjectId
  userId: string
  displayName: string
  timezone: string
  platforms: string[]
  createdAt: Date
}

export interface PersonaProfileDoc {
  _id: ObjectId
  creatorId: string
  archetype: string
  timezone: string
  data: PersonaProfile
  createdAt: Date
  updatedAt: Date
}

export interface Creator {
  id: string
  userId: string
  displayName: string
  timezone: string
  platforms: string[]
  createdAt: Date
}

const globalForMongo = globalThis as unknown as { mongoClient?: MongoClient }

export function getClient(): MongoClient {
  globalForMongo.mongoClient ??= new MongoClient(env.MONGODB_URI)
  return globalForMongo.mongoClient
}

export function getDb(): Db {
  return getClient().db(env.MONGODB_DB)
}

export function collections(): {
  creators: Collection<CreatorDoc>
  personaProfiles: Collection<PersonaProfileDoc>
} {
  const db = getDb()
  return {
    creators: db.collection<CreatorDoc>('creators'),
    personaProfiles: db.collection<PersonaProfileDoc>('personaProfiles'),
  }
}

export function toCreator(doc: CreatorDoc): Creator {
  return {
    id: doc._id.toHexString(),
    userId: doc.userId,
    displayName: doc.displayName,
    timezone: doc.timezone,
    platforms: doc.platforms,
    createdAt: doc.createdAt,
  }
}

export async function ensureIndexes(): Promise<void> {
  const { creators, personaProfiles } = collections()
  await creators.createIndex({ userId: 1 }, { unique: true })
  await personaProfiles.createIndex({ creatorId: 1 }, { unique: true })
}
