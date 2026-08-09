// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, type PlatformAccountDoc } from '@/db'
import { encryptToken } from '@/lib/token-crypto'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import {
  backfillYouTubeChannel,
  BACKFILL_CHUNK_DAYS,
  YoutubeBackfillError,
} from '@/lib/ingest/youtube-backfill'

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

function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
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
    const today = toUtcDateOnly(new Date())
    const SPAN_DAYS = 913 // ~2.5 years — ceil(913/365) = 3 chunks
    const publishedDate = new Date(today.getTime() - SPAN_DAYS * MS_PER_DAY)
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
    expect(reportsCalls[2]!.endDate).toBe(formatDate(today))
  })
})

describe('skip-existing-days', () => {
  it('skips days that already have a channel-scope snapshot and writes the rest', async () => {
    const account = await seedAccount()
    const today = toUtcDateOnly(new Date())
    const publishedDate = new Date(today.getTime() - 4 * MS_PER_DAY) // 5-day range, single chunk

    const dayStrings = Array.from({ length: 5 }, (_, i) =>
      formatDate(new Date(publishedDate.getTime() + i * MS_PER_DAY)),
    )

    const { metricSnapshots } = collections()
    for (const dayStr of [dayStrings[0]!, dayStrings[2]!]) {
      await metricSnapshots.insertOne({
        capturedAt: new Date(`${dayStr}T00:00:00.000Z`),
        meta: { creatorId: account.creatorId, platform: 'youtube', scope: 'channel' },
        metrics: { views: 1 },
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
    const today = toUtcDateOnly(new Date())
    const dayStr = formatDate(today)

    const { metricSnapshots } = collections()
    await metricSnapshots.insertOne({
      capturedAt: new Date(`${dayStr}T00:00:00.000Z`),
      meta: { creatorId: account.creatorId, platform: 'youtube', scope: 'channel' },
      metrics: { views: 1 },
    })

    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(today.toISOString()))
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

describe('day-row mapping', () => {
  it('maps row values to metric fields via columnHeaders regardless of column order, and omits null values', async () => {
    const account = await seedAccount()
    const today = toUtcDateOnly(new Date())
    const publishedDate = new Date(today.getTime() - 2 * MS_PER_DAY)
    const dayEmpty = formatDate(publishedDate)
    const dayFull = formatDate(new Date(today.getTime() - MS_PER_DAY))
    const dayPartial = formatDate(today)

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
      [null, dayPartial, null, 200, null],
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
      views: 1000,
      watchTimeMin: 500,
      avgViewDurationSec: 120,
      subscribersGained: 5,
    })

    const partialDoc = await metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      capturedAt: new Date(`${dayPartial}T00:00:00.000Z`),
    })
    expect(partialDoc?.metrics).toEqual({ views: 200 })
    expect('watchTimeMin' in (partialDoc?.metrics ?? {})).toBe(false)
    expect('avgViewDurationSec' in (partialDoc?.metrics ?? {})).toBe(false)
    expect('subscribersGained' in (partialDoc?.metrics ?? {})).toBe(false)
  })
})

describe('empty channel', () => {
  it('no-ops when reports.query returns no rows at all', async () => {
    const account = await seedAccount()
    const today = toUtcDateOnly(new Date())

    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(today.toISOString()))
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
    const today = toUtcDateOnly(new Date())
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
        return jsonResponse(channelFixture(today.toISOString()))
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
    const today = toUtcDateOnly(new Date())
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = String(url)
      expect(urlStr).not.toContain('current-access-token')
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(today.toISOString()))
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
    const today = toUtcDateOnly(new Date())
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(today.toISOString()))
      }
      return jsonResponse({ notColumnHeaders: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(backfillYouTubeChannel(account)).rejects.toThrow(YoutubeBackfillError)
  })

  it('throws when a required metric column is missing from columnHeaders', async () => {
    const account = await seedAccount()
    const today = toUtcDateOnly(new Date())
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture(today.toISOString()))
      }
      if (urlStr.startsWith(YOUTUBE_ANALYTICS_REPORTS_URL)) {
        return jsonResponse({
          columnHeaders: DEFAULT_COLUMN_HEADERS.filter((h) => h.name !== 'subscribersGained'),
          rows: [[formatDate(today), 10, 5, 60]],
        })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(backfillYouTubeChannel(account)).rejects.toThrow(YoutubeBackfillError)
  })
})
