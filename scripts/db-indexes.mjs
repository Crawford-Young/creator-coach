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
} catch (error) {
  console.error('Failed to create indexes:', error)
  process.exitCode = 1
} finally {
  await client.close()
}
