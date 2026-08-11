// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, type MetricSnapshotDoc } from '@/db'
import { getLiveStatuses } from '@/lib/metrics/live'

const MS_PER_MINUTE = 60000

function channelSnapshot(overrides: Partial<MetricSnapshotDoc> = {}): MetricSnapshotDoc {
  return {
    capturedAt: new Date(),
    meta: {
      creatorId: new ObjectId().toHexString(),
      platform: 'twitch',
      scope: 'channel',
    },
    metrics: {},
    ...overrides,
  }
}

describe('getLiveStatuses', () => {
  it('a ccv row 5 minutes old reports live with the viewer count', async () => {
    const creatorId = new ObjectId().toHexString()
    await collections().metricSnapshots.insertOne(
      channelSnapshot({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        capturedAt: new Date(Date.now() - 5 * MS_PER_MINUTE),
        metrics: { ccv: 88 },
      }),
    )

    const status = (await getLiveStatuses(creatorId, ['twitch'], new Date())).twitch

    expect(status).toEqual({ live: true, ccv: 88 })
  })

  it('a ccv row 20 minutes old (outside the live window) reports not live', async () => {
    const creatorId = new ObjectId().toHexString()
    await collections().metricSnapshots.insertOne(
      channelSnapshot({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        capturedAt: new Date(Date.now() - 20 * MS_PER_MINUTE),
        metrics: { ccv: 88 },
      }),
    )

    const status = (await getLiveStatuses(creatorId, ['twitch'], new Date())).twitch

    expect(status).toEqual({ live: false })
  })

  it('a recent channel row without a ccv key reports not live', async () => {
    const creatorId = new ObjectId().toHexString()
    await collections().metricSnapshots.insertOne(
      channelSnapshot({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        capturedAt: new Date(),
        metrics: { followers: 100 },
      }),
    )

    const status = (await getLiveStatuses(creatorId, ['twitch'], new Date())).twitch

    expect(status).toEqual({ live: false })
  })

  it('no snapshots at all for the creator reports not live', async () => {
    const creatorId = new ObjectId().toHexString()

    const status = (await getLiveStatuses(creatorId, ['twitch'], new Date())).twitch

    expect(status).toEqual({ live: false })
  })

  it('returns the most recent ccv row when multiple land within the window', async () => {
    const creatorId = new ObjectId().toHexString()
    await collections().metricSnapshots.insertOne(
      channelSnapshot({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        capturedAt: new Date(Date.now() - 12 * MS_PER_MINUTE),
        metrics: { ccv: 50 },
      }),
    )
    await collections().metricSnapshots.insertOne(
      channelSnapshot({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        capturedAt: new Date(Date.now() - 2 * MS_PER_MINUTE),
        metrics: { ccv: 75 },
      }),
    )

    const status = (await getLiveStatuses(creatorId, ['twitch'], new Date())).twitch

    expect(status).toEqual({ live: true, ccv: 75 })
  })

  // The caller owns the clock (finding A applied to the other read-path
  // consumer): the staleness window is measured back from the instant the page
  // resolved, not from a second clock read inside the query. Testable without
  // real-clock fixtures precisely because the instant is an argument.
  it("measures the live window back from the caller's instant, not its own clock", async () => {
    const creatorId = new ObjectId().toHexString()
    const capturedAt = new Date()
    await collections().metricSnapshots.insertOne(
      channelSnapshot({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        capturedAt,
        metrics: { ccv: 88 },
      }),
    )

    const halfHourLater = new Date(capturedAt.getTime() + 30 * MS_PER_MINUTE)

    const status = (await getLiveStatuses(creatorId, ['twitch'], halfHourLater)).twitch

    expect(status).toEqual({ live: false })
  })

  // Only Twitch has a live concept, and that fact lives HERE rather than at
  // each of the three call sites that used to encode it. A creator with no
  // Twitch link gets no live entry at all — and no query fires to produce one.
  it('reports nothing for a creator whose linked platforms have no live concept', async () => {
    const creatorId = new ObjectId().toHexString()
    await collections().metricSnapshots.insertOne(
      channelSnapshot({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        capturedAt: new Date(),
        metrics: { ccv: 88 },
      }),
    )

    expect(await getLiveStatuses(creatorId, ['youtube'], new Date())).toEqual({})
  })

  it('reports nothing when no platform is linked at all', async () => {
    const creatorId = new ObjectId().toHexString()

    expect(await getLiveStatuses(creatorId, [], new Date())).toEqual({})
  })
})
