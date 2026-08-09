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

export type Platform = 'twitch' | 'youtube' | 'tiktok' | 'instagram'
export type PlatformAccountStatus = 'active' | 'reauth_required' | 'disconnected'
export type ContentType = 'video' | 'short' | 'vod' | 'clip' | 'stream'

export interface AuthAccountDoc {
  _id: ObjectId
  userId: ObjectId // adapter format.to stores ObjectId, not the hex string
  provider: string
  providerAccountId: string
  type: string
  access_token?: string
  refresh_token?: string
  expires_at?: number // epoch seconds
  scope?: string
  token_type?: string
  id_token?: string
}

export interface PlatformAccountDoc {
  _id: ObjectId
  creatorId: string // hex string per repo ObjectId contract
  platform: Platform
  externalId: string
  handle: string
  accessToken: string // encrypted v1: format — NEVER plaintext
  refreshToken?: string // encrypted
  tokenExpiresAt?: Date
  scopes: string[]
  status: PlatformAccountStatus
  linkedAt: Date
  lastSyncAt?: Date
  uploadsPlaylistId?: string
}

export interface ContentItemDoc {
  _id: ObjectId
  creatorId: string
  platform: Platform
  type: ContentType
  externalId: string
  title: string
  publishedAt: Date
  url: string
  thumbnailUrl?: string
  durationSec?: number
  raw: unknown // verbatim API payload
  firstSeenAt: Date
  lastSyncAt: Date
}

// metricSnapshots is a native MongoDB time-series collection (see
// ensureTimeseries below). Time-series collections support NO unique
// indexes and no upserts — write-path idempotency here is a
// query-before-insert design, owned by the ingestion tasks, not this file.
export interface MetricSnapshotDoc {
  capturedAt: Date // timeField
  meta: {
    creatorId: string
    platform: Platform
    scope: 'channel' | 'item'
    itemExternalId?: string
  }
  metrics: {
    views?: number
    likes?: number
    comments?: number
    shares?: number
    followers?: number
    subscribers?: number
    subPoints?: number
    watchTimeMin?: number
    avgViewDurationSec?: number
    ccv?: number
    // ORCHESTRATOR AMENDMENT (W1 T9): the YouTube Analytics reports.query
    // day-series exposes this as a day-delta metric (subscribers gained
    // that day, can be negative) — distinct from `subscribers`, the
    // point-in-time channel total from channels.list statistics.
    subscribersGained?: number
  }
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
  platformAccounts: Collection<PlatformAccountDoc>
  contentItems: Collection<ContentItemDoc>
  metricSnapshots: Collection<MetricSnapshotDoc>
  authAccounts: Collection<AuthAccountDoc>
} {
  const db = getDb()
  return {
    creators: db.collection<CreatorDoc>('creators'),
    personaProfiles: db.collection<PersonaProfileDoc>('personaProfiles'),
    platformAccounts: db.collection<PlatformAccountDoc>('platformAccounts'),
    contentItems: db.collection<ContentItemDoc>('contentItems'),
    metricSnapshots: db.collection<MetricSnapshotDoc>('metricSnapshots'),
    authAccounts: db.collection<AuthAccountDoc>('accounts'),
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
  const { creators, personaProfiles, platformAccounts, contentItems } = collections()
  await creators.createIndex({ userId: 1 }, { unique: true })
  await personaProfiles.createIndex({ creatorId: 1 }, { unique: true })
  await platformAccounts.createIndex({ creatorId: 1, platform: 1 }, { unique: true })
  await contentItems.createIndex({ platform: 1, externalId: 1 }, { unique: true })
}

const METRIC_SNAPSHOTS_COLLECTION = 'metricSnapshots'

// Native time-series collection for metricSnapshots. Idempotent: a second
// createCollection call on an already-existing collection throws, so every
// call checks listCollections first — this guards `just db-indexes` and
// ensureTimeseries() being run more than once against the same database.
export async function ensureTimeseries(): Promise<void> {
  const db = getDb()
  const existing = await db.listCollections({ name: METRIC_SNAPSHOTS_COLLECTION }).toArray()
  if (existing.length > 0) {
    return
  }
  await db.createCollection(METRIC_SNAPSHOTS_COLLECTION, {
    timeseries: {
      timeField: 'capturedAt',
      metaField: 'meta',
      granularity: 'hours',
    },
  })
}
