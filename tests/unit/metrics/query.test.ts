// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, type MetricSnapshotDoc } from '@/db'
import { queryChannelSeries, queryItemSeries, rangeStart } from '@/lib/metrics/query'

const MS_PER_DAY = 86400000

// Named generically (not "channelSnapshot") — reused for both channel- and
// item-scope docs across this file's describe blocks.
function snapshotDoc(overrides: Partial<MetricSnapshotDoc> = {}): MetricSnapshotDoc {
  return {
    capturedAt: new Date(),
    meta: {
      creatorId: new ObjectId().toHexString(),
      platform: 'twitch',
      scope: 'channel',
    },
    metrics: { followers: 10 },
    ...overrides,
  }
}

describe('rangeStart', () => {
  const now = new Date('2026-08-10T12:00:00.000Z')

  it('7d returns 7 days before now', () => {
    expect(rangeStart('7d', now)).toEqual(new Date(now.getTime() - 7 * MS_PER_DAY))
  })

  it('30d returns 30 days before now', () => {
    expect(rangeStart('30d', now)).toEqual(new Date(now.getTime() - 30 * MS_PER_DAY))
  })

  it('90d returns 90 days before now', () => {
    expect(rangeStart('90d', now)).toEqual(new Date(now.getTime() - 90 * MS_PER_DAY))
  })

  it("'all' returns null", () => {
    expect(rangeStart('all', now)).toBeNull()
  })
})

describe('queryChannelSeries', () => {
  it('dedupes duplicate same-day channel rows to one point, later capturedAt wins per key (TOCTOU #4 closure)', async () => {
    const creatorId = new ObjectId().toHexString()
    const earlier = new Date('2026-08-05T08:00:00.000Z')
    const later = new Date('2026-08-05T20:00:00.000Z')
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        capturedAt: earlier,
        metrics: { followers: 10 },
      }),
    )
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        capturedAt: later,
        metrics: { followers: 12 },
      }),
    )

    const series = await queryChannelSeries(creatorId, { platforms: ['twitch'], range: 'all' })

    expect(series).toHaveLength(1)
    expect(series[0]).toEqual({ day: '2026-08-05', platform: 'twitch', metrics: { followers: 12 } })
  })

  it('a later ccv-only row does not drop that day’s followers — merged object carries both keys', async () => {
    const creatorId = new ObjectId().toHexString()
    const earlier = new Date('2026-08-06T08:00:00.000Z')
    const later = new Date('2026-08-06T20:00:00.000Z')
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        capturedAt: earlier,
        metrics: { followers: 10, subscribers: 5 },
      }),
    )
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        capturedAt: later,
        metrics: { ccv: 42 },
      }),
    )

    const series = await queryChannelSeries(creatorId, { platforms: ['twitch'], range: 'all' })

    expect(series).toHaveLength(1)
    expect(series[0]?.metrics).toEqual({ followers: 10, subscribers: 5, ccv: 42 })
  })

  it('range filter: 7d excludes an 8-day-old row; all includes it', async () => {
    const creatorId = new ObjectId().toHexString()
    const eightDaysAgo = new Date(Date.now() - 8 * MS_PER_DAY)
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        capturedAt: eightDaysAgo,
        metrics: { followers: 1 },
      }),
    )

    const sevenDay = await queryChannelSeries(creatorId, { platforms: ['twitch'], range: '7d' })
    const all = await queryChannelSeries(creatorId, { platforms: ['twitch'], range: 'all' })

    expect(sevenDay).toHaveLength(0)
    expect(all).toHaveLength(1)
  })

  it('tenant + scope isolation: other-creator rows and item-scope rows are excluded', async () => {
    const creatorId = new ObjectId().toHexString()
    const otherCreatorId = new ObjectId().toHexString()
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        metrics: { followers: 1 },
      }),
    )
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId: otherCreatorId, platform: 'twitch', scope: 'channel' },
        metrics: { followers: 99 },
      }),
    )
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId, platform: 'twitch', scope: 'item', itemExternalId: 'vid-1' },
        metrics: { views: 5 },
      }),
    )

    const series = await queryChannelSeries(creatorId, { platforms: ['twitch'], range: 'all' })

    expect(series).toHaveLength(1)
    expect(series[0]?.metrics).toEqual({ followers: 1 })
  })

  it('zod: valid aggregation output parses; a non-numeric metric value rejects', async () => {
    const creatorId = new ObjectId().toHexString()
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        metrics: { followers: 1 },
      }),
    )

    await expect(
      queryChannelSeries(creatorId, { platforms: ['twitch'], range: 'all' }),
    ).resolves.toHaveLength(1)

    const badCreatorId = new ObjectId().toHexString()
    const badDoc = {
      capturedAt: new Date(),
      meta: { creatorId: badCreatorId, platform: 'twitch', scope: 'channel' },
      metrics: { followers: 'not-a-number' },
    } as unknown as MetricSnapshotDoc
    await collections().metricSnapshots.insertOne(badDoc)

    await expect(
      queryChannelSeries(badCreatorId, { platforms: ['twitch'], range: 'all' }),
    ).rejects.toThrow()
  })
})

describe('queryItemSeries', () => {
  it('filters by scope:item + itemExternalId (excludes channel rows and other items) and dedupes same-day rows', async () => {
    const creatorId = new ObjectId().toHexString()
    const itemExternalId = 'vod-123'
    const earlier = new Date('2026-08-05T08:00:00.000Z')
    const later = new Date('2026-08-05T20:00:00.000Z')
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId, platform: 'twitch', scope: 'item', itemExternalId },
        capturedAt: earlier,
        metrics: { views: 100 },
      }),
    )
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId, platform: 'twitch', scope: 'item', itemExternalId },
        capturedAt: later,
        metrics: { views: 150 },
      }),
    )
    // channel-scope row for the same creator — must be excluded
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        metrics: { followers: 1 },
      }),
    )
    // a different item's snapshot — must be excluded
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId, platform: 'twitch', scope: 'item', itemExternalId: 'other-vod' },
        metrics: { views: 999 },
      }),
    )

    const series = await queryItemSeries(creatorId, itemExternalId, 'all')

    expect(series).toEqual([{ day: '2026-08-05', platform: 'twitch', metrics: { views: 150 } }])
  })

  it('range filter: 7d excludes an 8-day-old item row; all includes it', async () => {
    const creatorId = new ObjectId().toHexString()
    const itemExternalId = 'vod-old'
    const eightDaysAgo = new Date(Date.now() - 8 * MS_PER_DAY)
    await collections().metricSnapshots.insertOne(
      snapshotDoc({
        meta: { creatorId, platform: 'twitch', scope: 'item', itemExternalId },
        capturedAt: eightDaysAgo,
        metrics: { views: 5 },
      }),
    )

    const sevenDay = await queryItemSeries(creatorId, itemExternalId, '7d')
    const all = await queryItemSeries(creatorId, itemExternalId, 'all')

    expect(sevenDay).toHaveLength(0)
    expect(all).toHaveLength(1)
  })
})
