import { z } from 'zod'
import type { Collection } from 'mongodb'
import { collections, type MetricSnapshotDoc, type Platform } from '@/db'

export type RangePreset = '7d' | '30d' | '90d' | 'all'

export interface DayMetrics {
  readonly day: string // 'YYYY-MM-DD' UTC
  readonly platform: Platform
  readonly metrics: Readonly<Record<string, number>>
}

const MS_PER_DAY = 86400000

const RANGE_DAYS: Record<Exclude<RangePreset, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

export function rangeStart(range: RangePreset, now: Date): Date | null {
  if (range === 'all') return null
  return new Date(now.getTime() - RANGE_DAYS[range] * MS_PER_DAY)
}

// Runtime mirror of the Platform union in @/db — zod needs an actual value
// list, not just the type, to validate aggregation output.
const PLATFORMS = [
  'twitch',
  'youtube',
  'tiktok',
  'instagram',
] as const satisfies readonly Platform[]

const dayMetricsSchema = z.object({
  day: z.string(),
  platform: z.enum(PLATFORMS),
  metrics: z.record(z.string(), z.number()),
})

interface ChannelSeriesOptions {
  readonly platforms: readonly Platform[]
  readonly range: RangePreset
}

interface ChannelMatchStage {
  readonly 'meta.creatorId': string
  readonly 'meta.scope': 'channel'
  readonly 'meta.platform': { $in: readonly Platform[] }
  readonly capturedAt?: { $gte: Date }
}

interface ItemMatchStage {
  readonly 'meta.creatorId': string
  readonly 'meta.scope': 'item'
  readonly 'meta.itemExternalId': string
  readonly capturedAt?: { $gte: Date }
}

// $mergeObjects folds every same-day/platform snapshot into one point, in
// capturedAt order (the preceding $sort), so a later ccv-only live-poll row
// (twitch.ts:437-442, written when checkLive finds the channel live) adds
// `ccv` onto that day's channel metrics instead of replacing them — a
// `$last`-whole-object dedupe would clobber that day's followers/views with
// `{ ccv }` whenever the live poll landed last. Shared by both channel- and
// item-scope queries — only the $match stage differs between them.
// P-14: `views` on a YouTube channel-scope snapshot has two writers with
// opposite meanings that share one day+platform bucket with no
// discriminator — youtubeConnector.syncChannel writes a CUMULATIVE lifetime
// total at a real wall-clock capturedAt; the (now-retired) Analytics
// backfill wrote that DAY's own views, stamped at exact UTC midnight
// (youtube-backfill.ts: `new Date(`${dayKey}T00:00:00.000Z`)`).
// METRIC_KINDS classifies `views` 'point' (last-minus-first), true only of
// the connector's meaning — a stored backfill row's `views` would corrupt
// that math. A migration to strip it from storage is impossible (time-series
// collections reject $unset on a measurement field — server error 72), so
// this strips it at READ time instead: a row is backfill-origin when its
// platform is youtube, its scope is channel, and its capturedAt is exactly
// UTC midnight — the one stamp only that writer ever produces. `$$REMOVE`
// drops the field entirely rather than nulling it; item-scope rows (any
// platform) and non-midnight channel rows are untouched by the $eq guards.
const IS_BACKFILL_ORIGIN_YOUTUBE_VIEWS: Record<string, unknown> = {
  $and: [
    { $eq: ['$meta.platform', 'youtube'] },
    { $eq: ['$meta.scope', 'channel'] },
    { $eq: ['$capturedAt', { $dateTrunc: { date: '$capturedAt', unit: 'day' } }] },
  ],
}

async function aggregateDaySeries(
  metricSnapshots: Collection<MetricSnapshotDoc>,
  match: ChannelMatchStage | ItemMatchStage,
): Promise<DayMetrics[]> {
  const rows = await metricSnapshots
    .aggregate([
      { $match: match },
      { $sort: { capturedAt: 1 } },
      {
        $set: {
          'metrics.views': {
            $cond: [IS_BACKFILL_ORIGIN_YOUTUBE_VIEWS, '$$REMOVE', '$metrics.views'],
          },
        },
      },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$capturedAt' } },
            platform: '$meta.platform',
          },
          metrics: { $mergeObjects: '$metrics' },
        },
      },
      { $project: { _id: 0, day: '$_id.day', platform: '$_id.platform', metrics: 1 } },
      { $sort: { day: 1 } },
    ])
    .toArray()
  return z.array(dayMetricsSchema).parse(rows)
}

export async function queryChannelSeries(
  creatorId: string,
  options: ChannelSeriesOptions,
): Promise<DayMetrics[]> {
  const { metricSnapshots } = collections()
  const start = rangeStart(options.range, new Date())
  const match: ChannelMatchStage = {
    'meta.creatorId': creatorId,
    'meta.scope': 'channel',
    'meta.platform': { $in: options.platforms },
    ...(start !== null && { capturedAt: { $gte: start } }),
  }
  return aggregateDaySeries(metricSnapshots, match)
}

export async function queryItemSeries(
  creatorId: string,
  itemExternalId: string,
  range: RangePreset,
): Promise<DayMetrics[]> {
  const { metricSnapshots } = collections()
  const start = rangeStart(range, new Date())
  const match: ItemMatchStage = {
    'meta.creatorId': creatorId,
    'meta.scope': 'item',
    'meta.itemExternalId': itemExternalId,
    ...(start !== null && { capturedAt: { $gte: start } }),
  }
  return aggregateDaySeries(metricSnapshots, match)
}
