import { z } from 'zod'
import { collections, type MetricSnapshotDoc, type PlatformAccountDoc } from '@/db'
import { getFreshGoogleToken } from '@/lib/connectors/token-refresh'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'
const YOUTUBE_ANALYTICS_API_BASE = 'https://youtubeanalytics.googleapis.com/v2'
const HTTP_UNAUTHORIZED = 401
const MS_PER_DAY = 86400000

// A full-history channel day series in one reports.query call is untested
// at doc-recon time — chunk conservatively at one year per request.
export const BACKFILL_CHUNK_DAYS = 365

// Doc-recon: the most recent few days lag in the Analytics API (no exact
// number documented) — the daily sync cron (T10) fills them in on its next
// run, so an incomplete final day here is expected, not a bug.
const REPORTS_METRICS = 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained'

export interface BackfillResult {
  daysWritten: number
  daysSkipped: number
  chunks: number
}

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
async function authorizedGet(account: PlatformAccountDoc, url: string): Promise<unknown> {
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

function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() < b.getTime() ? a : b
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

interface DateRange {
  start: Date
  end: Date
}

function chunkDateRange(start: Date, end: Date, chunkDays: number): DateRange[] {
  const ranges: DateRange[] = []
  let chunkStart = start
  while (chunkStart.getTime() <= end.getTime()) {
    const chunkEnd = minDate(addDays(chunkStart, chunkDays - 1), end)
    ranges.push({ start: chunkStart, end: chunkEnd })
    chunkStart = addDays(chunkEnd, 1)
  }
  return ranges
}

const channelsEnvelopeSchema = z.object({
  items: z.array(z.object({ snippet: z.object({ publishedAt: z.string() }) })).min(1),
})

async function fetchChannelPublishedAt(account: PlatformAccountDoc): Promise<Date> {
  const url = `${YOUTUBE_API_BASE}/channels?part=snippet&mine=true`
  const json = await authorizedGet(account, url)
  const parsed = channelsEnvelopeSchema.safeParse(json)
  if (!parsed.success) {
    throw new YoutubeBackfillError('Malformed channels.list response envelope')
  }
  // channelsEnvelopeSchema enforces items.min(1) — a successful parse
  // guarantees this index is present.
  return new Date(parsed.data.items[0].snippet.publishedAt)
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

function buildReportsQueryUrl(start: Date, end: Date): string {
  const url = new URL(`${YOUTUBE_ANALYTICS_API_BASE}/reports`)
  url.searchParams.set('ids', 'channel==MINE')
  url.searchParams.set('startDate', formatDate(start))
  url.searchParams.set('endDate', formatDate(end))
  url.searchParams.set('metrics', REPORTS_METRICS)
  url.searchParams.set('dimensions', 'day')
  return url.toString()
}

async function fetchReportsQuery(
  account: PlatformAccountDoc,
  start: Date,
  end: Date,
): Promise<ReportsQueryResponse> {
  const json = await authorizedGet(account, buildReportsQueryUrl(start, end))
  const parsed = reportsQueryResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new YoutubeBackfillError('Malformed reports.query response envelope')
  }
  return parsed.data
}

const REQUIRED_COLUMNS = [
  'day',
  'views',
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

function rowToMetrics(row: RowCell[], columnIndex: ColumnIndex): MetricSnapshotDoc['metrics'] {
  const metrics: MetricSnapshotDoc['metrics'] = {}

  const views = numericMetricValue(row[columnIndex.views])
  if (views !== undefined) {
    metrics.views = views
  }
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
 * Full-history channel-level day series backfill from the YouTube Analytics
 * API, chunked at BACKFILL_CHUNK_DAYS and idempotent against the
 * metricSnapshots time-series collection (no upserts/unique indexes exist
 * there — idempotency is query-before-insert, owned entirely by this
 * function). Safe to re-run on every re-link without duplicating the series.
 */
export async function backfillYouTubeChannel(account: PlatformAccountDoc): Promise<BackfillResult> {
  const publishedAt = await fetchChannelPublishedAt(account)
  const startDate = toUtcDateOnly(publishedAt)
  const endDate = toUtcDateOnly(new Date())
  const ranges = chunkDateRange(startDate, endDate, BACKFILL_CHUNK_DAYS)

  const { metricSnapshots } = collections()
  let daysWritten = 0
  let daysSkipped = 0

  for (const range of ranges) {
    const report = await fetchReportsQuery(account, range.start, range.end)
    if (!report.rows || report.rows.length === 0) {
      continue
    }

    const columnIndex = resolveColumnIndex(report.columnHeaders)

    const existing = await metricSnapshots
      .find({
        'meta.creatorId': account.creatorId,
        'meta.platform': 'youtube',
        'meta.scope': 'channel',
        capturedAt: { $gte: range.start, $lte: range.end },
      })
      .toArray()
    const existingDayKeys = new Set(existing.map((doc) => formatDate(doc.capturedAt)))

    const toInsert: MetricSnapshotDoc[] = []
    for (const row of report.rows) {
      const dayKey = String(row[columnIndex.day])
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
  }

  return { daysWritten, daysSkipped, chunks: ranges.length }
}
