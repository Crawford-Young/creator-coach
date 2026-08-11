import { collections, type Platform } from '@/db'

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
 * offline signal. This queries for the most recent such row inside the live
 * window ENDING AT `now`; anything else (no row, or the most recent one stale
 * as of `now`) reports not live.
 */
async function getTwitchLiveStatus(creatorId: string, now: Date): Promise<LiveStatus> {
  const { metricSnapshots } = collections()
  const since = new Date(now.getTime() - LIVE_WINDOW_MS)
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

// Which platforms have a live concept at all, and how each is checked. Twitch
// is the only connector writing a ccv row; YouTube live is not modelled, and
// TikTok/Instagram have no connector. Owning the fact here is what keeps it out
// of the page, the serializer and the card.
const LIVE_CHECKS: Partial<
  Record<Platform, (creatorId: string, now: Date) => Promise<LiveStatus>>
> = {
  twitch: getTwitchLiveStatus,
}

/**
 * Live status for whichever of a creator's linked platforms can be live. A
 * platform absent from the result has no live concept — distinct from a linked
 * Twitch channel that is simply offline, which reports `{ live: false }`. A
 * creator with no live-capable platform costs no query at all.
 *
 * `now` is the caller's instant, the same one the metric queries measure their
 * range back from — the read path reads one clock, and no exception to that is
 * worth the untestable staleness window a second read would buy.
 */
export async function getLiveStatuses(
  creatorId: string,
  platforms: readonly Platform[],
  now: Date,
): Promise<Partial<Record<Platform, LiveStatus>>> {
  const statuses: Partial<Record<Platform, LiveStatus>> = {}
  await Promise.all(
    platforms.map(async (platform) => {
      const check = LIVE_CHECKS[platform]
      if (check === undefined) return
      statuses[platform] = await check(creatorId, now)
    }),
  )
  return statuses
}
