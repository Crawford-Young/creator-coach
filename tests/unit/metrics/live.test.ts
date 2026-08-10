// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, type MetricSnapshotDoc } from '@/db'
import { getTwitchLiveStatus } from '@/lib/metrics/live'

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

describe('getTwitchLiveStatus', () => {
  it('a ccv row 5 minutes old reports live with the viewer count', async () => {
    const creatorId = new ObjectId().toHexString()
    await collections().metricSnapshots.insertOne(
      channelSnapshot({
        meta: { creatorId, platform: 'twitch', scope: 'channel' },
        capturedAt: new Date(Date.now() - 5 * MS_PER_MINUTE),
        metrics: { ccv: 88 },
      }),
    )

    const status = await getTwitchLiveStatus(creatorId)

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

    const status = await getTwitchLiveStatus(creatorId)

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

    const status = await getTwitchLiveStatus(creatorId)

    expect(status).toEqual({ live: false })
  })

  it('no snapshots at all for the creator reports not live', async () => {
    const creatorId = new ObjectId().toHexString()

    const status = await getTwitchLiveStatus(creatorId)

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

    const status = await getTwitchLiveStatus(creatorId)

    expect(status).toEqual({ live: true, ccv: 75 })
  })
})
