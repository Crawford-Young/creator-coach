// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, type PlatformAccountDoc } from '@/db'
import { encryptToken } from '@/lib/token-crypto'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { backfillYouTubeChannel, BACKFILL_CHUNK_DAYS } from '@/lib/ingest/youtube-backfill'
import {
  ANALYTICS_LAG_DAYS,
  formatDate,
  toUtcDateOnly,
  YoutubeBackfillError,
} from '@/lib/connectors/youtube-analytics'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'
const YOUTUBE_ANALYTICS_REPORTS_URL = 'https://youtubeanalytics.googleapis.com/v2/reports'
const SECONDS_TO_MS = 1000
const MS_PER_DAY = 86400000
const QUOTA_EXCEEDED_STATUS = 403

function futureDate(secondsFromNow: number): Date {
  return new Date(Date.now() + secondsFromNow * SECONDS_TO_MS)
}

function uniqueId(label: string): string {
  return `${label}-${new ObjectId().toHexString()}`
}

function daysAgo(days: number): Date {
  return new Date(toUtcDateOnly(new Date()).getTime() - days * MS_PER_DAY)
}

async function seedAccount(
  overrides: Partial<PlatformAccountDoc> = {},
): Promise<PlatformAccountDoc> {
  const doc: PlatformAccountDoc = {
    _id: new ObjectId(),
    creatorId: new ObjectId().toHexString(),
    platform: 'youtube',
    externalId: uniqueId('yt-ext'),
    handle: 'YouTuber',
    accessToken: encryptToken('current-access-token'),
    refreshToken: encryptToken('current-refresh-token'),
    tokenExpiresAt: futureDate(3600),
    scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    status: 'active',
    linkedAt: new Date(),
    ...overrides,
  }
  await collections().platformAccounts.insertOne(doc)
  return doc
}

interface MockResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

function jsonResponse(body: unknown, status = 200): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function tokenRefreshResponse(): Record<string, unknown> {
  return {
    access_token: 'refreshed-access-token',
    expires_in: 3600,
    token_type: 'bearer',
  }
}

function channelFixture(publishedAt: string): Record<string, unknown> {
  return { items: [{ snippet: { publishedAt } }] }
}

const DEFAULT_COLUMN_HEADERS = [
  { name: 'day' },
  { name: 'views' },
  { name: 'estimatedMinutesWatched' },
  { name: 'averageViewDuration' },
  { name: 'subscribersGained' },
]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(Sentry.captureException).mockClear()
})

describe('chunk math', () => {
  it('splits a ~2.5-year range into 3 contiguous chunks capped at BACKFILL_CHUNK_DAYS', async () => {
    expect(BACKFILL_CHUNK_DAYS).toBe(365)
    const account = await seedAccount()
    const SPAN_DAYS = 913 // ~2.5 years — 911 settled days = 3 chunks
    const publishedDate = daysAgo(SPAN_DAYS)
    const lastSettledDay = daysAgo(ANALYTICS_LAG_DAYS)
    const reportsCalls: Array<{ startDate: string; endDate: string }> = []

    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(publishedDate.toISOString()))
      }
      if (urlStr.startsWith(YOUTUBE_ANALYTICS_REPORTS_URL)) {
        const parsedUrl = new URL(urlStr)
        reportsCalls.push({
          startDate: parsedUrl.searchParams.get('startDate') ?? '',
          endDate: parsedUrl.searchParams.get('endDate') ?? '',
        })
        return jsonResponse({ columnHeaders: DEFAULT_COLUMN_HEADERS, rows: [] })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await backfillYouTubeChannel(account)

    expect(reportsCalls).toHaveLength(3)
    expect(result.chunks).toBe(3)
    expect(result.daysWritten).toBe(0)
    expect(result.daysSkipped).toBe(0)

    for (const call of reportsCalls) {
      const start = new Date(`${call.startDate}T00:00:00.000Z`)
      const end = new Date(`${call.endDate}T00:00:00.000Z`)
      const spanDays = (end.getTime() - start.getTime()) / MS_PER_DAY + 1
      expect(spanDays).toBeLessThanOrEqual(BACKFILL_CHUNK_DAYS)
    }
    for (let i = 1; i < reportsCalls.length; i++) {
      const prevEnd = new Date(`${reportsCalls[i - 1]!.endDate}T00:00:00.000Z`)
      const nextStart = new Date(`${reportsCalls[i]!.startDate}T00:00:00.000Z`)
      expect(nextStart.getTime() - prevEnd.getTime()).toBe(MS_PER_DAY)
    }
    expect(reportsCalls[0]!.startDate).toBe(formatDate(publishedDate))
    expect(reportsCalls[2]!.endDate).toBe(formatDate(lastSettledDay))
  })
})

describe('lag boundary', () => {
  it('stops short of the unsettled days instead of freezing partial figures', async () => {
    const account = await seedAccount()
    const reportsCalls: Array<{ startDate: string; endDate: string }> = []
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(daysAgo(30).toISOString()))
      }
      if (urlStr.startsWith(YOUTUBE_ANALYTICS_REPORTS_URL)) {
        const parsedUrl = new URL(urlStr)
        reportsCalls.push({
          startDate: parsedUrl.searchParams.get('startDate') ?? '',
          endDate: parsedUrl.searchParams.get('endDate') ?? '',
        })
        return jsonResponse({ columnHeaders: DEFAULT_COLUMN_HEADERS, rows: [] })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await backfillYouTubeChannel(account)

    // A day requested before the API has finished revising it would be
    // written partial and could never be corrected — the collection takes no
    // updates. Those days belong to the daily sync, once settled.
    expect(reportsCalls).toHaveLength(1)
    expect(reportsCalls[0]!.endDate).toBe(formatDate(daysAgo(ANALYTICS_LAG_DAYS)))
    expect(ANALYTICS_LAG_DAYS).toBeGreaterThan(0)
  })

  it('requests nothing for a channel created inside the lag window', async () => {
    const account = await seedAccount()
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(daysAgo(ANALYTICS_LAG_DAYS - 1).toISOString()))
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await backfillYouTubeChannel(account)

    expect(result).toEqual({ daysWritten: 0, daysSkipped: 0, chunks: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('skip-existing-days', () => {
  it('skips days that already have a channel-scope snapshot and writes the rest', async () => {
    const account = await seedAccount()
    // 5 settled days ending on the lag boundary — a single chunk.
    const publishedDate = daysAgo(ANALYTICS_LAG_DAYS + 4)

    const dayStrings = Array.from({ length: 5 }, (_, i) =>
      formatDate(new Date(publishedDate.getTime() + i * MS_PER_DAY)),
    )

    const { metricSnapshots } = collections()
    for (const dayStr of [dayStrings[0]!, dayStrings[2]!]) {
      await metricSnapshots.insertOne({
        capturedAt: new Date(`${dayStr}T00:00:00.000Z`),
        meta: { creatorId: account.creatorId, platform: 'youtube', scope: 'channel' },
        metrics: { watchTimeMin: 1 },
      })
    }

    const rows = dayStrings.map((day, i) => [day, 100 + i, 50 + i, 120 + i, i])

    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(publishedDate.toISOString()))
      }
      if (urlStr.startsWith(YOUTUBE_ANALYTICS_REPORTS_URL)) {
        return jsonResponse({ columnHeaders: DEFAULT_COLUMN_HEADERS, rows })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await backfillYouTubeChannel(account)

    expect(result.chunks).toBe(1)
    expect(result.daysSkipped).toBe(2)
    expect(result.daysWritten).toBe(3)

    const count = await metricSnapshots.countDocuments({
      'meta.creatorId': account.creatorId,
      'meta.scope': 'channel',
    })
    expect(count).toBe(5)
  })

  it('does not call insertMany when every row in a chunk is already present', async () => {
    const account = await seedAccount()
    const lastSettledDay = daysAgo(ANALYTICS_LAG_DAYS)
    const dayStr = formatDate(lastSettledDay)

    const { metricSnapshots } = collections()
    await metricSnapshots.insertOne({
      capturedAt: new Date(`${dayStr}T00:00:00.000Z`),
      meta: { creatorId: account.creatorId, platform: 'youtube', scope: 'channel' },
      metrics: { watchTimeMin: 1 },
    })

    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(lastSettledDay.toISOString()))
      }
      if (urlStr.startsWith(YOUTUBE_ANALYTICS_REPORTS_URL)) {
        return jsonResponse({ columnHeaders: DEFAULT_COLUMN_HEADERS, rows: [[dayStr, 1, 2, 3, 4]] })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await backfillYouTubeChannel(account)

    expect(result.daysWritten).toBe(0)
    expect(result.daysSkipped).toBe(1)
    const count = await metricSnapshots.countDocuments({
      'meta.creatorId': account.creatorId,
      'meta.scope': 'channel',
    })
    expect(count).toBe(1)
  })
})

describe('re-link over connector rows', () => {
  it('writes the analytics rows for days that already carry a wall-clock connector snapshot', async () => {
    const account = await seedAccount()
    // 3 settled days ending on the lag boundary — a single chunk.
    const publishedDate = daysAgo(ANALYTICS_LAG_DAYS + 2)
    const dayStrings = Array.from({ length: 3 }, (_, i) =>
      formatDate(new Date(publishedDate.getTime() + i * MS_PER_DAY)),
    )
    const CONNECTOR_CAPTURE_HOUR_MS = 14 * 3600 * 1000

    // The re-link shape: `youtubeConnector.syncChannel` has been writing a
    // wall-clock-stamped channel row every day, so days inside the backfill
    // range already carry a channel-scope snapshot that holds none of the
    // analytics metrics. A skip-check keyed on the day alone would match
    // those rows and leave their analytics permanently unwritten — the daily
    // sync only ever revisits the last few days.
    const { metricSnapshots } = collections()
    for (const dayStr of [dayStrings[0]!, dayStrings[1]!]) {
      await metricSnapshots.insertOne({
        capturedAt: new Date(
          new Date(`${dayStr}T00:00:00.000Z`).getTime() + CONNECTOR_CAPTURE_HOUR_MS,
        ),
        meta: { creatorId: account.creatorId, platform: 'youtube', scope: 'channel' },
        metrics: { subscribers: 10, views: 20 },
      })
    }

    const rows = dayStrings.map((day, i) => [day, 100 + i, 50 + i, 120 + i, i])
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(publishedDate.toISOString()))
      }
      if (urlStr.startsWith(YOUTUBE_ANALYTICS_REPORTS_URL)) {
        return jsonResponse({ columnHeaders: DEFAULT_COLUMN_HEADERS, rows })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await backfillYouTubeChannel(account)

    expect(result.daysWritten).toBe(3)
    expect(result.daysSkipped).toBe(0)

    for (const [i, dayStr] of dayStrings.entries()) {
      const analyticsRow = await metricSnapshots.findOne({
        'meta.creatorId': account.creatorId,
        capturedAt: new Date(`${dayStr}T00:00:00.000Z`),
      })
      expect(analyticsRow?.metrics.watchTimeMin).toBe(50 + i)
    }
    // The connector rows survive untouched alongside the analytics rows.
    const count = await metricSnapshots.countDocuments({
      'meta.creatorId': account.creatorId,
      'meta.scope': 'channel',
    })
    expect(count).toBe(5)
  })
})

describe('day-row mapping', () => {
  it('maps row values to metric fields via columnHeaders regardless of column order, and omits null values', async () => {
    const account = await seedAccount()
    const publishedDate = daysAgo(ANALYTICS_LAG_DAYS + 2)
    const dayEmpty = formatDate(publishedDate)
    const dayFull = formatDate(daysAgo(ANALYTICS_LAG_DAYS + 1))
    const dayPartial = formatDate(daysAgo(ANALYTICS_LAG_DAYS))
    // P-14: the report's per-day `views` column is a different quantity from
    // the connector's cumulative lifetime `views`, and both land in the same
    // day+platform bucket — so the analytics path writes neither.

    // Deliberately NOT in the doc-recon's example order — proves
    // header-driven mapping rather than positional assumption.
    const columnHeaders = [
      { name: 'subscribersGained' },
      { name: 'day' },
      { name: 'averageViewDuration' },
      { name: 'views' },
      { name: 'estimatedMinutesWatched' },
    ]
    const rows = [
      [null, dayEmpty, null, null, null],
      [5, dayFull, 120, 1000, 500],
      [null, dayPartial, null, 200, 300],
    ]

    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(publishedDate.toISOString()))
      }
      if (urlStr.startsWith(YOUTUBE_ANALYTICS_REPORTS_URL)) {
        return jsonResponse({ columnHeaders, rows })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await backfillYouTubeChannel(account)

    expect(result.daysWritten).toBe(3)

    const { metricSnapshots } = collections()
    const emptyDoc = await metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      capturedAt: new Date(`${dayEmpty}T00:00:00.000Z`),
    })
    expect(emptyDoc?.metrics).toEqual({})

    const fullDoc = await metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      capturedAt: new Date(`${dayFull}T00:00:00.000Z`),
    })
    expect(fullDoc?.metrics).toEqual({
      watchTimeMin: 500,
      avgViewDurationSec: 120,
      subscribersGained: 5,
    })
    // The row carried views=1000 and it was still dropped — P-14 is about the
    // writer, not about absent data.
    expect('views' in (fullDoc?.metrics ?? {})).toBe(false)

    const partialDoc = await metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      capturedAt: new Date(`${dayPartial}T00:00:00.000Z`),
    })
    expect(partialDoc?.metrics).toEqual({ watchTimeMin: 300 })
    expect('views' in (partialDoc?.metrics ?? {})).toBe(false)
    expect('avgViewDurationSec' in (partialDoc?.metrics ?? {})).toBe(false)
    expect('subscribersGained' in (partialDoc?.metrics ?? {})).toBe(false)
  })
})

describe('malformed day cell', () => {
  it('skips a row whose day cell is not a valid YYYY-MM-DD date, reports it, and still writes the valid rows in the same chunk', async () => {
    const account = await seedAccount()
    const publishedDate = daysAgo(ANALYTICS_LAG_DAYS + 1)
    const validDay = formatDate(daysAgo(ANALYTICS_LAG_DAYS))
    // Row order matches DEFAULT_COLUMN_HEADERS: day, views, estimatedMinutesWatched,
    // averageViewDuration, subscribersGained. A null `day` cell stringifies to the
    // literal 'null', which `new Date('nullT00:00:00.000Z')` turns into an Invalid
    // Date — the write this skip check exists to prevent.
    const rows = [
      [null, 5, 10, 15, 1],
      [validDay, 100, 50, 120, 5],
    ]

    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(publishedDate.toISOString()))
      }
      if (urlStr.startsWith(YOUTUBE_ANALYTICS_REPORTS_URL)) {
        return jsonResponse({ columnHeaders: DEFAULT_COLUMN_HEADERS, rows })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await backfillYouTubeChannel(account)

    expect(result.daysWritten).toBe(1)
    expect(result.daysSkipped).toBe(1)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)

    const { metricSnapshots } = collections()
    const count = await metricSnapshots.countDocuments({ 'meta.creatorId': account.creatorId })
    expect(count).toBe(1)
    const validDoc = await metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      capturedAt: new Date(`${validDay}T00:00:00.000Z`),
    })
    expect(validDoc?.metrics.watchTimeMin).toBe(50)
  })
})

describe('empty channel', () => {
  it('no-ops when reports.query returns no rows at all', async () => {
    const account = await seedAccount()

    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(daysAgo(ANALYTICS_LAG_DAYS).toISOString()))
      }
      if (urlStr.startsWith(YOUTUBE_ANALYTICS_REPORTS_URL)) {
        return jsonResponse({ columnHeaders: DEFAULT_COLUMN_HEADERS })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await backfillYouTubeChannel(account)

    expect(result).toEqual({ daysWritten: 0, daysSkipped: 0, chunks: 1 })
  })
})

describe('token refresh / error status handling', () => {
  it('forces a token refresh and retries once on 401, then succeeds', async () => {
    const account = await seedAccount()
    let channelsCallCount = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = String(url)
      if (init?.method === 'POST') {
        expect(urlStr).toBe(GOOGLE_TOKEN_URL)
        return jsonResponse(tokenRefreshResponse())
      }
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        channelsCallCount += 1
        if (channelsCallCount === 1) {
          return jsonResponse({ error: 'unauthorized' }, 401)
        }
        const headers = init?.headers as Record<string, string> | undefined
        expect(headers?.Authorization).toBe('Bearer refreshed-access-token')
        return jsonResponse(channelFixture(daysAgo(ANALYTICS_LAG_DAYS).toISOString()))
      }
      if (urlStr.startsWith(YOUTUBE_ANALYTICS_REPORTS_URL)) {
        return jsonResponse({ columnHeaders: DEFAULT_COLUMN_HEADERS, rows: [] })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await backfillYouTubeChannel(account)

    expect(channelsCallCount).toBe(2)
    expect(result.chunks).toBe(1)
  })

  it('throws a YoutubeBackfillError carrying the status on a non-401 error from the initial call', async () => {
    const account = await seedAccount()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'quotaExceeded' }, QUOTA_EXCEEDED_STATUS)),
    )

    let caught: unknown
    try {
      await backfillYouTubeChannel(account)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(YoutubeBackfillError)
    expect((caught as YoutubeBackfillError).status).toBe(QUOTA_EXCEEDED_STATUS)
  })

  it('throws when the retried call also returns 401', async () => {
    const account = await seedAccount()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse(tokenRefreshResponse())
      }
      return jsonResponse({ error: 'unauthorized' }, 401)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(backfillYouTubeChannel(account)).rejects.toThrow(YoutubeBackfillError)
  })

  it('throws a YoutubeBackfillError carrying the status on a non-401 error from the post-401-retry call', async () => {
    const account = await seedAccount()
    let channelsCallCount = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse(tokenRefreshResponse())
      }
      channelsCallCount += 1
      if (channelsCallCount === 1) {
        return jsonResponse({ error: 'unauthorized' }, 401)
      }
      return jsonResponse({ error: 'quotaExceeded' }, QUOTA_EXCEEDED_STATUS)
    })
    vi.stubGlobal('fetch', fetchMock)

    let caught: unknown
    try {
      await backfillYouTubeChannel(account)
    } catch (error) {
      caught = error
    }
    expect(channelsCallCount).toBe(2)
    expect(caught).toBeInstanceOf(YoutubeBackfillError)
    expect((caught as YoutubeBackfillError).status).toBe(QUOTA_EXCEEDED_STATUS)
  })
})

describe('request shape', () => {
  it('sends Authorization: Bearer on reports.query and never puts the token/secret in the URL', async () => {
    const account = await seedAccount()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = String(url)
      expect(urlStr).not.toContain('current-access-token')
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(daysAgo(ANALYTICS_LAG_DAYS).toISOString()))
      }
      if (urlStr.startsWith(YOUTUBE_ANALYTICS_REPORTS_URL)) {
        const headers = init?.headers as Record<string, string> | undefined
        expect(headers?.Authorization).toBe('Bearer current-access-token')
        return jsonResponse({ columnHeaders: DEFAULT_COLUMN_HEADERS, rows: [] })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await backfillYouTubeChannel(account)

    expect(fetchMock).toHaveBeenCalled()
  })
})

describe('malformed responses', () => {
  it('throws when the channels.list envelope is malformed', async () => {
    const account = await seedAccount()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ notItems: [] })),
    )
    await expect(backfillYouTubeChannel(account)).rejects.toThrow(YoutubeBackfillError)
  })

  it('throws when the reports.query envelope is malformed', async () => {
    const account = await seedAccount()
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(daysAgo(ANALYTICS_LAG_DAYS).toISOString()))
      }
      return jsonResponse({ notColumnHeaders: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(backfillYouTubeChannel(account)).rejects.toThrow(YoutubeBackfillError)
  })

  it('throws when a required metric column is missing from columnHeaders', async () => {
    const account = await seedAccount()
    const lastSettledDay = daysAgo(ANALYTICS_LAG_DAYS)
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(lastSettledDay.toISOString()))
      }
      if (urlStr.startsWith(YOUTUBE_ANALYTICS_REPORTS_URL)) {
        return jsonResponse({
          columnHeaders: DEFAULT_COLUMN_HEADERS.filter((h) => h.name !== 'subscribersGained'),
          rows: [[formatDate(lastSettledDay), 10, 5, 60]],
        })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(backfillYouTubeChannel(account)).rejects.toThrow(YoutubeBackfillError)
  })
})
