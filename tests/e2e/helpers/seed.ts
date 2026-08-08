import { randomUUID } from 'node:crypto'
import { MongoClient, ObjectId, type Db } from 'mongodb'
import type { PersonaProfile } from '@/lib/persona/schema'

const E2E_MONGO_URI = 'mongodb://127.0.0.1:27097'
const E2E_MONGO_DB = 'creator-coach-e2e'
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000

const client = new MongoClient(E2E_MONGO_URI)
let connected: Promise<MongoClient> | undefined

async function db(): Promise<Db> {
  connected ??= client.connect()
  await connected
  return client.db(E2E_MONGO_DB)
}

export interface SeededSession {
  readonly sessionToken: string
  readonly userId: string
}

// Session shape must match `@auth/mongodb-adapter`'s read path exactly:
// - `getSessionAndUser` finds the session by plain `{ sessionToken }` match.
// - `format.from(session)` calls `session.userId.toHexString()` when converting the
//   read doc to the plain session object — this REQUIRES userId to be a BSON ObjectId
//   instance; a stored hex string would throw at that call.
// (verified: node_modules/.pnpm/@auth+mongodb-adapter@3.11.3_mongodb@6.21.0/node_modules/@auth/mongodb-adapter/index.js:85-89)
export async function seedSession(): Promise<SeededSession> {
  const database = await db()
  const userObjectId = new ObjectId()
  await database.collection('users').insertOne({
    _id: userObjectId,
    name: 'E2E Creator',
    email: 'e2e-creator@example.com',
    emailVerified: null,
  })
  const sessionToken = randomUUID()
  await database.collection('sessions').insertOne({
    sessionToken,
    userId: userObjectId,
    expires: new Date(Date.now() + SESSION_LIFETIME_MS),
  })
  return { sessionToken, userId: userObjectId.toHexString() }
}

export async function seedCreator(userId: string): Promise<string> {
  const database = await db()
  const creatorId = new ObjectId()
  await database.collection('creators').insertOne({
    _id: creatorId,
    userId,
    displayName: 'E2E Creator',
    timezone: 'UTC',
    platforms: ['twitch'],
    createdAt: new Date(),
  })
  return creatorId.toHexString()
}

const VALID_PERSONA_PROFILE: PersonaProfile = {
  identity: { mainDraw: 'community heart', archetype: 'community-heart' },
  contentPillars: {
    anchor: { name: 'CS2', mode: 'ranked + squad nights' },
    rotation: ['Valorant'],
  },
  voice: {
    toneWords: ['calm'],
    sampleLines: ['gg'],
    dos: ['uplift'],
    donts: ['rage'],
    wildcardDial: 6,
  },
  philosophy: { values: ['care'], statement: 'people first' },
  audience: { description: 'the campfire', servesWho: 'regulars' },
  constraints: {
    timezone: 'Europe/London',
    weeklySchedule: 'eves',
    collabAvailability: 'weekends',
  },
  sustainability: {
    energyPatterns: 'morning low',
    burnoutTriggers: ['over-streaming'],
    restNeeds: '1 day/wk',
  },
  platforms: { primary: { type: 'twitch', handle: 'x' }, clipTargets: ['tiktok'] },
}

export async function seedPersona(creatorId: string): Promise<void> {
  const database = await db()
  const now = new Date()
  await database.collection('personaProfiles').insertOne({
    _id: new ObjectId(),
    creatorId,
    archetype: VALID_PERSONA_PROFILE.identity.archetype,
    timezone: VALID_PERSONA_PROFILE.constraints.timezone,
    data: VALID_PERSONA_PROFILE,
    createdAt: now,
    updatedAt: now,
  })
}

export async function findPersonaProfile(creatorId: string): Promise<{ creatorId: string } | null> {
  const database = await db()
  return database.collection<{ creatorId: string }>('personaProfiles').findOne({ creatorId })
}

const SEEDED_COLLECTIONS = ['users', 'sessions', 'accounts', 'creators', 'personaProfiles']

export async function wipe(): Promise<void> {
  const database = await db()
  await Promise.all(
    SEEDED_COLLECTIONS.map(async (name) => {
      try {
        await database.collection(name).drop()
      } catch {
        // collection doesn't exist yet — nothing to drop
      }
    }),
  )
}
