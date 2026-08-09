#!/usr/bin/env node
// Standalone ops script — creates the production MongoDB indexes.
// Invoke via `just db-indexes` (node --env-file=.env scripts/db-indexes.mjs).
// Mirrors src/db/index.ts's ensureIndexes(); duplicated here deliberately —
// this script must run without pulling in @t3-oss/env-nextjs or Next.js.

import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI
const dbName = process.env.MONGODB_DB

if (!uri) {
  console.error('MONGODB_URI is not set — aborting')
  process.exit(1)
}

if (!dbName) {
  console.error('MONGODB_DB is not set — aborting')
  process.exit(1)
}

const client = new MongoClient(uri)

try {
  await client.connect()
  const db = client.db(dbName)

  const creatorsIndex = await db.collection('creators').createIndex({ userId: 1 }, { unique: true })
  console.log(`creators.${creatorsIndex} created`)

  const personaProfilesIndex = await db
    .collection('personaProfiles')
    .createIndex({ creatorId: 1 }, { unique: true })
  console.log(`personaProfiles.${personaProfilesIndex} created`)

  const platformAccountsIndex = await db
    .collection('platformAccounts')
    .createIndex({ creatorId: 1, platform: 1 }, { unique: true })
  console.log(`platformAccounts.${platformAccountsIndex} created`)

  const contentItemsIndex = await db
    .collection('contentItems')
    .createIndex({ platform: 1, externalId: 1 }, { unique: true })
  console.log(`contentItems.${contentItemsIndex} created`)

  // Native time-series collection — createCollection throws on an already
  // existing collection, so this checks listCollections first. Guards
  // every second run of `just db-indexes` against crashing in prod ops.
  const metricSnapshotsExists = await db.listCollections({ name: 'metricSnapshots' }).toArray()
  if (metricSnapshotsExists.length === 0) {
    await db.createCollection('metricSnapshots', {
      timeseries: {
        timeField: 'capturedAt',
        metaField: 'meta',
        granularity: 'hours',
      },
    })
    console.log('metricSnapshots time-series collection created')
  } else {
    console.log('metricSnapshots time-series collection already exists')
  }
} catch (error) {
  console.error('Failed to create indexes:', error)
  process.exitCode = 1
} finally {
  await client.close()
}
