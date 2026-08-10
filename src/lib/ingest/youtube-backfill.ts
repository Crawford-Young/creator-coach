import { z } from 'zod'
import type { PlatformAccountDoc } from '@/db'
import {
  addDays,
  authorizedGet,
  settledAnalyticsBoundary,
  toUtcDateOnly,
  writeChannelAnalyticsRange,
  YoutubeBackfillError,
  type DateRange,
} from '@/lib/connectors/youtube-analytics'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

// A full-history channel day series in one reports.query call is untested
// at doc-recon time — chunk conservatively at one year per request.
export const BACKFILL_CHUNK_DAYS = 365

export interface BackfillResult {
  daysWritten: number
  daysSkipped: number
  chunks: number
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() < b.getTime() ? a : b
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

/**
 * Full-history channel-level day series backfill from the YouTube Analytics
 * API, chunked at BACKFILL_CHUNK_DAYS. Each chunk is written by the shared
 * `writeChannelAnalyticsRange`, which owns the query-before-insert
 * idempotency this collection needs (no upserts/unique indexes exist on a
 * time-series collection). Safe to re-run on every re-link without
 * duplicating the series.
 */
export async function backfillYouTubeChannel(account: PlatformAccountDoc): Promise<BackfillResult> {
  const publishedAt = await fetchChannelPublishedAt(account)
  const startDate = toUtcDateOnly(publishedAt)
  // Stops at the settled boundary rather than at today: a day fetched while
  // the API is still revising it would be frozen partial forever (no updates
  // on a time-series collection). The daily analytics sync writes those days
  // once they settle, which is what makes ANALYTICS_LAG_DAYS' comment true.
  const ranges = chunkDateRange(startDate, settledAnalyticsBoundary(), BACKFILL_CHUNK_DAYS)

  let daysWritten = 0
  let daysSkipped = 0
  for (const range of ranges) {
    const written = await writeChannelAnalyticsRange(account, range)
    daysWritten += written.daysWritten
    daysSkipped += written.daysSkipped
  }

  return { daysWritten, daysSkipped, chunks: ranges.length }
}
