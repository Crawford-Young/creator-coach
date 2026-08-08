// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import {
  collections,
  ensureIndexes,
  getClient,
  getDb,
  toCreator,
  type CreatorDoc,
} from '@/db/mongo'

describe('mongo client', () => {
  it('getClient returns the same cached instance on repeat calls', () => {
    expect(getClient()).toBe(getClient())
  })

  it('getDb resolves the test database configured via globalSetup', () => {
    expect(getDb().databaseName).toBe('creator-coach-test')
  })

  it('ensureIndexes enforces a unique index on creators.userId', async () => {
    await ensureIndexes()
    const { creators } = collections()
    const userId = randomUUID()
    const doc: CreatorDoc = {
      _id: new ObjectId(),
      userId,
      displayName: 'Unique Test Creator',
      timezone: 'UTC',
      platforms: ['twitch'],
      createdAt: new Date(),
    }
    await creators.insertOne(doc)
    await expect(creators.insertOne({ ...doc, _id: new ObjectId() })).rejects.toThrow()
  })

  it('toCreator maps _id to a hex id string and preserves the other fields', () => {
    const createdAt = new Date()
    const doc: CreatorDoc = {
      _id: new ObjectId(),
      userId: randomUUID(),
      displayName: 'Mapped Creator',
      timezone: 'America/Chicago',
      platforms: ['twitch', 'youtube'],
      createdAt,
    }

    const creator = toCreator(doc)

    expect(creator).toEqual({
      id: doc._id.toHexString(),
      userId: doc.userId,
      displayName: doc.displayName,
      timezone: doc.timezone,
      platforms: doc.platforms,
      createdAt,
    })
  })
})
