import { z } from 'zod'
import * as Sentry from '@sentry/nextjs'
import { collections, type MetricSnapshotDoc, type PlatformAccountDoc } from '@/db'
import { getFreshGoogleToken } from './token-refresh'

const YOUTUBE_ANALYTICS_API_BASE = 'https://youtubeanalytics.googleapis.com/v2'
const HTTP_UNAUTHORIZED = 401
const MS_PER_DAY = 86400000

// The Analytics API keeps revising the most recent days' figures for a few
// days after each day closes (no exact number is documented). metricSnapshots
// is a time-series collection that accepts no updates, so a day written while
// its report is still partial could never be corrected afterwards. Every
// writer therefore stops this many days short of today, and the daily
// analytics sync (`youtubeConnector.syncChannel`) writes each day once it has
// settled past this boundary.
export const ANALYTICS_LAG_DAYS = 3

// P-14: `views` is deliberately NOT requested — the per-day figure this
// report returns is a different quantity from the cumulative `views` the
// connector writes into the same bucket, and nothing displays per-day views.
// Exported so `tests/unit/metrics/query.test.ts` can assert this directly:
// the read-side strip at `query.ts`'s `IS_BACKFILL_ORIGIN_YOUTUBE_VIEWS`
// silently `$$REMOVE`s `views` from every exact-midnight YouTube channel
// row, so a re-added `views` here would vanish at read time with nothing to
// catch it.
export const REPORTS_METRICS = 'estimatedMinutesWatched,averageViewDuration,subscribersGained'

// Name retained from the link-time backfill that first owned this code: it is
// the typed error for every YouTube Analytics call, on both the backfill and
// the daily-sync path.
export class YoutubeBackfillError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'YoutubeBackfillError'
    this.status = status
  }
}

function bearerHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

/**
 * GET a Google API URL, refreshing the account's token first. On a 401,
 * forces a refresh and retries the call exactly once — a second 401, or any
 * other non-OK status on either attempt, is a hard failure.
 */
export async function authorizedGet(account: PlatformAccountDoc, url: string): Promise<unknown> {
  const token = await getFreshGoogleToken(account)
  const response = await fetch(url, { headers: bearerHeaders(token.accessToken) })
  if (response.ok) {
    return response.json()
  }
  if (response.status !== HTTP_UNAUTHORIZED) {
    throw new YoutubeBackfillError(
      `YouTube API request failed with status ${response.status}: ${url}`,
      response.status,
    )
  }

  const refreshed = await getFreshGoogleToken(account, { forceRefresh: true })
  const retryResponse = await fetch(url, { headers: bearerHeaders(refreshed.accessToken) })
  if (retryResponse.ok) {
    return retryResponse.json()
  }
  throw new YoutubeBackfillError(
    retryResponse.status === HTTP_UNAUTHORIZED
      ? `YouTube API unauthorized after token refresh retry: ${url}`
      : `YouTube API request failed with status ${retryResponse.status}: ${url}`,
    retryResponse.status,
  )
}

export function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The most recent day whose figures the Analytics API has finished revising —
 * the last day any writer may commit to the time-series collection. Both the
 * link-time backfill and the daily sync end their range here, so the boundary
 * is stated once rather than recomputed per caller.
 */
export function settledAnalyticsBoundary(): Date {
  return addDays(toUtcDateOnly(new Date()), -ANALYTICS_LAG_DAYS)
}

export interface DateRange {
  readonly start: Date
  readonly end: Date
}

const rowCellSchema = z.union([z.string(), z.number(), z.null()])
type RowCell = z.infer<typeof rowCellSchema>

const columnHeaderSchema = z.object({ name: z.string() })
type ColumnHeader = z.infer<typeof columnHeaderSchema>

const reportsQueryResponseSchema = z.object({
  columnHeaders: z.array(columnHeaderSchema),
  rows: z.array(z.array(rowCellSchema)).optional(),
})
type ReportsQueryResponse = z.infer<typeof reportsQueryResponseSchema>

function buildReportsQueryUrl(range: DateRange): string {
  const url = new URL(`${YOUTUBE_ANALYTICS_API_BASE}/reports`)
  url.searchParams.set('ids', 'channel==MINE')
  url.searchParams.set('startDate', formatDate(range.start))
  url.searchParams.set('endDate', formatDate(range.end))
  url.searchParams.set('metrics', REPORTS_METRICS)
  url.searchParams.set('dimensions', 'day')
  return url.toString()
}

async function fetchReportsQuery(
  account: PlatformAccountDoc,
  range: DateRange,
): Promise<ReportsQueryResponse> {
  const json = await authorizedGet(account, buildReportsQueryUrl(range))
  const parsed = reportsQueryResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new YoutubeBackfillError('Malformed reports.query response envelope')
  }
  return parsed.data
}

const REQUIRED_COLUMNS = [
  'day',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'subscribersGained',
] as const

type RequiredColumn = (typeof REQUIRED_COLUMNS)[number]
type ColumnIndex = Record<RequiredColumn, number>

// Column position is NEVER assumed from doc-recon's example order — the API
// does not guarantee it, so every position is derived from the response's
// own columnHeaders.
function resolveColumnIndex(columnHeaders: ColumnHeader[]): ColumnIndex {
  const index = {} as ColumnIndex
  for (const column of REQUIRED_COLUMNS) {
    const position = columnHeaders.findIndex((header) => header.name === column)
    if (position === -1) {
      throw new YoutubeBackfillError(`reports.query response missing required column: ${column}`)
    }
    index[column] = position
  }
  return index
}

// Absent/null row values are omitted from the metrics object entirely —
// never coerced to zero.
function numericMetricValue(cell: RowCell | undefined): number | undefined {
  if (cell === null || cell === undefined) {
    return undefined
  }
  return Number(cell)
}

/**
 * Maps one `dimensions=day` report row to a metrics object.
 *
 * P-14: the report's `views` column is that DAY's views, while `views` on a
 * channel-scope snapshot means the channel's cumulative lifetime total
 * (`youtubeConnector.syncChannel`). Both writers share one day+platform
 * bucket with no discriminator, so the analytics path writes no `views` at
 * all — one meaning per key, and `METRIC_KINDS`' `'point'` classification of
 * `views` is true of the only remaining writer.
 */
function rowToMetrics(row: RowCell[], columnIndex: ColumnIndex): MetricSnapshotDoc['metrics'] {
  const metrics: MetricSnapshotDoc['metrics'] = {}

  const watchTimeMin = numericMetricValue(row[columnIndex.estimatedMinutesWatched])
  if (watchTimeMin !== undefined) {
    metrics.watchTimeMin = watchTimeMin
  }
  const avgViewDurationSec = numericMetricValue(row[columnIndex.averageViewDuration])
  if (avgViewDurationSec !== undefined) {
    metrics.avgViewDurationSec = avgViewDurationSec
  }
  const subscribersGained = numericMetricValue(row[columnIndex.subscribersGained])
  if (subscribersGained !== undefined) {
    metrics.subscribersGained = subscribersGained
  }

  return metrics
}

/**
 * True for a snapshot written by an analytics path, which stamps `capturedAt`
 * at exact UTC midnight of the day the row describes. `syncChannel` stamps
 * its own channel row with wall-clock `new Date()`.
 *
 * The discriminator is load-bearing: a day-key skip check that matched ANY
 * channel-scope row would match the connector row this same account wrote
 * that day and skip the day's analytics insert forever, silently. It lives
 * inside `writeChannelAnalyticsRange` so neither writer can forget it.
 */
function isAnalyticsSnapshot(snapshot: Pick<MetricSnapshotDoc, 'capturedAt'>): boolean {
  return snapshot.capturedAt.getTime() === toUtcDateOnly(snapshot.capturedAt).getTime()
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// `rowCellSchema` admits null, so a row's `day` cell can stringify to the
// literal 'null' — `new Date('nullT00:00:00.000Z')` is an Invalid Date, and
// writing one to a time-series `capturedAt` (the collection's timeField)
// would corrupt that row silently. This is also the ONLY place that can
// catch it: the daily sync's caller (`youtube.ts`'s `syncChannelAnalytics`)
// isolates every failure from here behind a try/catch, and an Invalid Date
// day key can never match `existingDayKeys`, so an unguarded write would
// re-fail (or re-corrupt) every night forever with nothing but a swallowed
// error to show for it.
function isValidDayKey(dayKey: string): boolean {
  return (
    DAY_KEY_PATTERN.test(dayKey) && !Number.isNaN(new Date(`${dayKey}T00:00:00.000Z`).getTime())
  )
}

export interface AnalyticsWriteResult {
  readonly daysWritten: number
  readonly daysSkipped: number
}

/**
 * Fetches the channel-level day series for one settled date range and inserts
 * a midnight-stamped snapshot per day that has no analytics row yet — the one
 * write path shared by the link-time backfill and the daily sync.
 *
 * Idempotency against the metricSnapshots time-series collection (no upserts
 * or unique indexes exist there) is query-before-insert, owned entirely by
 * this function.
 */
export async function writeChannelAnalyticsRange(
  account: PlatformAccountDoc,
  range: DateRange,
): Promise<AnalyticsWriteResult> {
  const report = await fetchReportsQuery(account, range)
  if (!report.rows || report.rows.length === 0) {
    return { daysWritten: 0, daysSkipped: 0 }
  }
  const columnIndex = resolveColumnIndex(report.columnHeaders)

  const { metricSnapshots } = collections()
  const existing = await metricSnapshots
    .find(
      {
        'meta.creatorId': account.creatorId,
        'meta.platform': 'youtube',
        'meta.scope': 'channel',
        capturedAt: { $gte: range.start, $lte: range.end },
      },
      { projection: { capturedAt: 1 } },
    )
    .toArray()
  const existingDayKeys = new Set(
    existing.filter(isAnalyticsSnapshot).map((doc) => formatDate(doc.capturedAt)),
  )

  let daysWritten = 0
  let daysSkipped = 0
  const toInsert: MetricSnapshotDoc[] = []
  for (const row of report.rows) {
    const dayKey = String(row[columnIndex.day])
    if (!isValidDayKey(dayKey)) {
      Sentry.captureException(
        new YoutubeBackfillError(`reports.query row has an invalid day cell: ${dayKey}`),
      )
      daysSkipped += 1
      continue
    }
    if (existingDayKeys.has(dayKey)) {
      daysSkipped += 1
      continue
    }
    toInsert.push({
      capturedAt: new Date(`${dayKey}T00:00:00.000Z`),
      meta: {
        creatorId: account.creatorId,
        platform: 'youtube',
        scope: 'channel',
      },
      metrics: rowToMetrics(row, columnIndex),
    })
    daysWritten += 1
  }

  if (toInsert.length > 0) {
    await metricSnapshots.insertMany(toInsert)
  }

  return { daysWritten, daysSkipped }
}
