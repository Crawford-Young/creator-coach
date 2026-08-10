import { collections } from '@/db'

export interface LiveStatus {
  readonly live: boolean
  readonly ccv?: number
}

// Poll cadence is */10 min (live-poll cron); 15 min gives one missed poll of
// slack before a stream is treated as offline.
const LIVE_WINDOW_MS = 15 * 60000

/**
 * `checkLive` (src/lib/connectors/twitch.ts:428-443) inserts a channel-scope
 * row with `metrics: { ccv }` ONLY while the channel is live, and inserts
 * NOTHING when offline — so staleness (or absence) of a ccv row IS the
 * offline signal. This queries for the most recent such row within the live
 * window; anything else (no row, or the most recent one now stale) reports
 * not live.
 */
export async function getTwitchLiveStatus(creatorId: string): Promise<LiveStatus> {
  const { metricSnapshots } = collections()
  const since = new Date(Date.now() - LIVE_WINDOW_MS)
  const row = await metricSnapshots.findOne(
    {
      'meta.creatorId': creatorId,
      'meta.scope': 'channel',
      'meta.platform': 'twitch',
      'metrics.ccv': { $exists: true },
      capturedAt: { $gte: since },
    },
    { sort: { capturedAt: -1 } },
  )
  if (!row) {
    return { live: false }
  }
  return { live: true, ccv: row.metrics.ccv }
}
