// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Db, ObjectId } from 'mongodb'
import {
  collections,
  ensureIndexes,
  ensureTimeseries,
  getDb,
  type PlatformAccountDoc,
  type ContentItemDoc,
  type MetricSnapshotDoc,
} from '@/db'

describe('W1 stats data model', () => {
  it('creates platformAccounts, contentItems, and metricSnapshots collections', async () => {
    await ensureIndexes()
    await ensureTimeseries()

    const names = await getDb().listCollections().toArray()
    const names_ = names.map((c) => c.name)

    expect(names_).toContain('platformAccounts')
    expect(names_).toContain('contentItems')
    expect(names_).toContain('metricSnapshots')
  })

  it('metricSnapshots is a native time-series collection keyed on capturedAt/meta', async () => {
    await ensureTimeseries()

    const found = await getDb()
      .listCollections({ name: 'metricSnapshots' }, { nameOnly: false })
      .toArray()
    expect(found).toHaveLength(1)
    expect(found[0]?.options?.timeseries).toMatchObject({
      timeField: 'capturedAt',
      metaField: 'meta',
      granularity: 'hours',
    })
  })

  it('ensureTimeseries is idempotent — a second call does not throw', async () => {
    await ensureTimeseries()
    await expect(ensureTimeseries()).resolves.not.toThrow()
  })

  it('ensureTimeseries rethrows non-NamespaceExists createCollection errors', async () => {
    const spy = vi.spyOn(Db.prototype, 'createCollection').mockRejectedValueOnce(new Error('boom'))
    try {
      await expect(ensureTimeseries()).rejects.toThrow('boom')
    } finally {
      spy.mockRestore()
    }
  })

  it('rejects a duplicate (creatorId, platform) platformAccounts insert', async () => {
    await ensureIndexes()
    const { platformAccounts } = collections()
    const creatorId = randomUUID()
    const doc: PlatformAccountDoc = {
      _id: new ObjectId(),
      creatorId,
      platform: 'twitch',
      externalId: randomUUID(),
      handle: 'unique_handle_1',
      accessToken: 'encrypted:test',
      scopes: ['channel:read:subscriptions'],
      status: 'active',
      linkedAt: new Date(),
    }
    await platformAccounts.insertOne(doc)
    await expect(
      platformAccounts.insertOne({
        ...doc,
        _id: new ObjectId(),
        externalId: randomUUID(),
        handle: 'unique_handle_1_dup',
      }),
    ).rejects.toThrow(/E11000/)
  })

  it('rejects a duplicate (platform, externalId) contentItems insert', async () => {
    await ensureIndexes()
    const { contentItems } = collections()
    const externalId = randomUUID()
    const doc: ContentItemDoc = {
      _id: new ObjectId(),
      creatorId: randomUUID(),
      platform: 'youtube',
      type: 'video',
      externalId,
      title: 'Unique content item',
      publishedAt: new Date(),
      url: 'https://youtube.com/watch?v=' + externalId,
      raw: { ok: true },
      firstSeenAt: new Date(),
      lastSyncAt: new Date(),
    }
    await contentItems.insertOne(doc)
    await expect(
      contentItems.insertOne({
        ...doc,
        _id: new ObjectId(),
        creatorId: randomUUID(),
      }),
    ).rejects.toThrow(/E11000/)
  })

  it('round-trips metricSnapshots inserts and filters reads by meta.creatorId', async () => {
    await ensureTimeseries()
    const { metricSnapshots } = collections()
    const creatorIdA = randomUUID()
    const creatorIdB = randomUUID()

    const docA: MetricSnapshotDoc = {
      capturedAt: new Date(),
      meta: { creatorId: creatorIdA, platform: 'twitch', scope: 'channel' },
      metrics: { followers: 100, ccv: 12 },
    }
    const docB: MetricSnapshotDoc = {
      capturedAt: new Date(),
      meta: { creatorId: creatorIdB, platform: 'youtube', scope: 'channel' },
      metrics: { subscribers: 200 },
    }

    await metricSnapshots.insertMany([docA, docB])

    const found = await metricSnapshots.find({ 'meta.creatorId': creatorIdA }).toArray()
    expect(found).toHaveLength(1)
    expect(found[0]?.metrics.followers).toBe(100)
  })
})
