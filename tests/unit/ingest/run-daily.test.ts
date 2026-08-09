// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, type ContentItemDoc, type PlatformAccountDoc } from '@/db'
import { encryptToken } from '@/lib/token-crypto'
import { logger } from '@/lib/logger'
import { env } from '@/env'

vi.mock('@/lib/connectors/twitch', () => ({
  twitchConnector: {
    syncChannel: vi.fn(),
    syncContent: vi.fn(),
    syncMetrics: vi.fn(),
  },
  checkLive: vi.fn(),
}))
vi.mock('@/lib/connectors/youtube', () => ({
  youtubeConnector: {
    syncChannel: vi.fn(),
    syncContent: vi.fn(),
    syncMetrics: vi.fn(),
  },
}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { twitchConnector } from '@/lib/connectors/twitch'
import { youtubeConnector } from '@/lib/connectors/youtube'
import { ReauthRequiredError } from '@/lib/connectors/token-refresh'
import {
  runDailyIngest,
  isAuthorizedCronRequest,
  RECENT_ITEMS_SYNC_LIMIT,
} from '@/lib/ingest/run-daily'
import { GET as dailyIngestGET } from '@/app/api/cron/daily-ingest/route'

function uniqueId(label: string): string {
  return `${label}-${new ObjectId().toHexString()}`
}

// runDailyIngest queries ALL status:'active' platformAccounts globally — it
// takes no creatorId, so its summary carries no per-account identifier to
// filter by. Combined with the shared-memory-server convention (never wipe
// collections between tests), leftover 'active' accounts from earlier tests
// in this file would get reprocessed by every later call. Tracking and
// deleting exactly what THIS file's tests created (never a blanket wipe)
// keeps each test's summary exact without touching other files' data.
const createdAccountIds: ObjectId[] = []

async function seedAccount(
  overrides: Partial<PlatformAccountDoc> = {},
): Promise<PlatformAccountDoc> {
  const doc: PlatformAccountDoc = {
    _id: new ObjectId(),
    creatorId: new ObjectId().toHexString(),
    platform: 'twitch',
    externalId: uniqueId('ext'),
    handle: 'Streamer',
    accessToken: encryptToken('current-access-token'),
    refreshToken: encryptToken('current-refresh-token'),
    tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
    scopes: [],
    status: 'active',
    linkedAt: new Date(),
    ...overrides,
  }
  await collections().platformAccounts.insertOne(doc)
  createdAccountIds.push(doc._id)
  return doc
}

function seedContentItem(overrides: Partial<ContentItemDoc> = {}): ContentItemDoc {
  return {
    _id: new ObjectId(),
    creatorId: new ObjectId().toHexString(),
    platform: 'twitch',
    type: 'vod',
    externalId: uniqueId('item'),
    title: 'A video',
    publishedAt: new Date(),
    url: 'https://example.com/video',
    raw: {},
    firstSeenAt: new Date(),
    lastSyncAt: new Date(),
    ...overrides,
  }
}

afterEach(async () => {
  vi.mocked(twitchConnector.syncChannel).mockReset()
  vi.mocked(twitchConnector.syncContent).mockReset()
  vi.mocked(twitchConnector.syncMetrics).mockReset()
  vi.mocked(youtubeConnector.syncChannel).mockReset()
  vi.mocked(youtubeConnector.syncContent).mockReset()
  vi.mocked(youtubeConnector.syncMetrics).mockReset()
  vi.mocked(Sentry.captureException).mockClear()
  vi.restoreAllMocks()
  if (createdAccountIds.length > 0) {
    await collections().platformAccounts.deleteMany({ _id: { $in: createdAccountIds } })
    createdAccountIds.length = 0
  }
})

describe('runDailyIngest', () => {
  it('syncs channel, content, then metrics for every active account, routed by platform connector', async () => {
    const twitchAccount = await seedAccount({ platform: 'twitch' })
    const youtubeAccount = await seedAccount({ platform: 'youtube' })

    const summary = await runDailyIngest()

    expect(twitchConnector.syncChannel).toHaveBeenCalledWith(
      expect.objectContaining({ _id: twitchAccount._id }),
    )
    expect(twitchConnector.syncContent).toHaveBeenCalledWith(
      expect.objectContaining({ _id: twitchAccount._id }),
    )
    expect(twitchConnector.syncMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ _id: twitchAccount._id }),
      [],
    )
    expect(youtubeConnector.syncChannel).toHaveBeenCalledWith(
      expect.objectContaining({ _id: youtubeAccount._id }),
    )
    expect(summary).toEqual(
      expect.arrayContaining([
        { platform: 'twitch', ok: true },
        { platform: 'youtube', ok: true },
      ]),
    )
    // NOT toHaveLength: runDailyIngest scans ALL status:'active' accounts
    // globally (no per-account identifier in its return shape to filter
    // by), and this repo's shared-memory-server convention never wipes
    // other test files' leftover 'active' fixtures — so healthy (ok:true)
    // noise rows from concurrently-running suites are expected here.
    // Identity-scoped toHaveBeenCalledWith assertions above are the
    // reliable check; presence-only assertions below are the reliable
    // fallback for the summary itself.
  })

  it('skips accounts on a platform with no registered connector, silently — no summary row', async () => {
    await seedAccount({ platform: 'tiktok' })
    const twitchAccount = await seedAccount({ platform: 'twitch' })

    const summary = await runDailyIngest()

    // 'tiktok' appears in no other test file's fixtures (grepped) and has
    // no CONNECTORS entry — its absence here is a reliable signal
    // regardless of shared-DB noise from other platforms.
    expect(summary.some((row) => row.platform === 'tiktok')).toBe(false)
    expect(twitchConnector.syncChannel).toHaveBeenCalledWith(
      expect.objectContaining({ _id: twitchAccount._id }),
    )
  })

  it('ignores accounts that are not status: active', async () => {
    const account = await seedAccount({ platform: 'twitch', status: 'reauth_required' })

    await runDailyIngest()

    expect(twitchConnector.syncChannel).not.toHaveBeenCalledWith(
      expect.objectContaining({ _id: account._id }),
    )
  })

  it('one account throwing does not stop siblings — both siblings synced, summary rows exact', async () => {
    const failing = await seedAccount({ platform: 'twitch' })
    const ok = await seedAccount({ platform: 'youtube' })
    vi.mocked(twitchConnector.syncChannel).mockImplementationOnce(async () => {
      throw new Error('twitch is down')
    })

    const summary = await runDailyIngest()

    expect(youtubeConnector.syncChannel).toHaveBeenCalledWith(
      expect.objectContaining({ _id: ok._id }),
    )
    // ok:false rows are exact regardless of shared-DB noise: only THIS
    // test's own mockImplementationOnce produces a failure — every noise
    // account resolves ok:true by default.
    const errorRows = summary.filter((row) => !row.ok)
    expect(errorRows).toEqual([{ platform: 'twitch', ok: false, error: 'twitch is down' }])
    void failing
  })

  it('a ReauthRequiredError account is skipped without re-reporting to Sentry or logger.error', async () => {
    const account = await seedAccount({ platform: 'twitch' })
    const sentrySpy = vi.mocked(Sentry.captureException)
    const loggerErrorSpy = vi.spyOn(logger, 'error')
    vi.mocked(twitchConnector.syncChannel).mockImplementationOnce(async () => {
      throw new ReauthRequiredError(account.creatorId, 'twitch')
    })

    const summary = await runDailyIngest()

    const errorRows = summary.filter((row) => !row.ok)
    expect(errorRows).toEqual([{ platform: 'twitch', ok: false, error: 'reauth_required' }])
    // Sentry/logger mocks are per-test-file module instances (vitest
    // isolates module registries per file) — safe to assert "not called"
    // exactly even though the DB itself is shared.
    expect(sentrySpy).not.toHaveBeenCalled()
    expect(loggerErrorSpy).not.toHaveBeenCalled()
  })

  it('a non-reauth error is reported to Sentry and logger.error, and siblings still continue', async () => {
    const failing = await seedAccount({ platform: 'twitch' })
    const ok = await seedAccount({ platform: 'youtube' })
    const sentrySpy = vi.mocked(Sentry.captureException)
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never)
    const boom = new Error('boom')
    vi.mocked(twitchConnector.syncChannel).mockImplementationOnce(async () => {
      throw boom
    })

    const summary = await runDailyIngest()

    expect(sentrySpy).toHaveBeenCalledTimes(1)
    expect(sentrySpy).toHaveBeenCalledWith(boom)
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
    const errorRows = summary.filter((row) => !row.ok)
    expect(errorRows).toEqual([{ platform: 'twitch', ok: false, error: 'boom' }])
    expect(youtubeConnector.syncChannel).toHaveBeenCalledWith(
      expect.objectContaining({ _id: ok._id }),
    )
    void failing
  })

  it('a non-Error throw is stringified as "unknown error" in the summary', async () => {
    const account = await seedAccount({ platform: 'twitch' })
    vi.spyOn(logger, 'error').mockImplementation(() => undefined as never)
    vi.mocked(twitchConnector.syncChannel).mockImplementationOnce(async () => {
      throw 'a string, not an Error'
    })

    const summary = await runDailyIngest()

    const errorRows = summary.filter((row) => !row.ok)
    expect(errorRows).toEqual([{ platform: 'twitch', ok: false, error: 'unknown error' }])
    void account
  })

  it('full summary shape: platforms + ok flags + error strings exact across ok/reauth/other-error accounts', async () => {
    await seedAccount({ platform: 'twitch' }) // ok
    const reauth = await seedAccount({ platform: 'youtube' })
    const other = await seedAccount({ platform: 'twitch' })
    vi.spyOn(logger, 'error').mockImplementation(() => undefined as never)
    vi.mocked(youtubeConnector.syncChannel).mockImplementationOnce(async () => {
      throw new ReauthRequiredError(reauth.creatorId, 'youtube')
    })
    vi.mocked(twitchConnector.syncChannel)
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        throw new Error('other failure')
      })

    const summary = await runDailyIngest()

    // Error rows are exact and order-independent by content — only this
    // test's own configured throws produce ok:false rows.
    const errorRows = summary.filter((row) => !row.ok)
    expect(errorRows).toEqual(
      expect.arrayContaining([
        { platform: 'youtube', ok: false, error: 'reauth_required' },
        { platform: 'twitch', ok: false, error: 'other failure' },
      ]),
    )
    expect(errorRows).toHaveLength(2)
    expect(summary).toEqual(expect.arrayContaining([{ platform: 'twitch', ok: true }]))
    void other
  })

  it('passes syncMetrics the 50 newest contentItems by publishedAt, excluding the oldest', async () => {
    const account = await seedAccount({ platform: 'twitch' })
    const TOTAL_ITEMS = 51
    const { contentItems } = collections()
    const seeded: ContentItemDoc[] = []
    for (let i = 0; i < TOTAL_ITEMS; i += 1) {
      const item = seedContentItem({
        creatorId: account.creatorId,
        platform: 'twitch',
        externalId: `item-${i}`,
        publishedAt: new Date(Date.now() + i * 1000), // i=0 is oldest
      })
      seeded.push(item)
    }
    await contentItems.insertMany(seeded)

    await runDailyIngest()

    // Found by account identity, not index — other status:'active' noise
    // accounts from concurrently-running suites may also trigger
    // syncMetrics calls ahead of this one.
    const call = vi
      .mocked(twitchConnector.syncMetrics)
      .mock.calls.find(([calledAccount]) => calledAccount._id.equals(account._id))
    if (!call) {
      throw new Error('test setup: syncMetrics was not called for the seeded account')
    }
    const [, passedItems] = call
    expect(passedItems).toHaveLength(RECENT_ITEMS_SYNC_LIMIT)
    const passedExternalIds = new Set(passedItems.map((item) => item.externalId))
    expect(passedExternalIds.has('item-0')).toBe(false) // oldest excluded
    expect(passedExternalIds.has(`item-${TOTAL_ITEMS - 1}`)).toBe(true) // newest included
    // Newest-first ordering.
    for (let i = 1; i < passedItems.length; i += 1) {
      expect(passedItems[i - 1]!.publishedAt.getTime()).toBeGreaterThanOrEqual(
        passedItems[i]!.publishedAt.getTime(),
      )
    }
  })
})

describe('isAuthorizedCronRequest', () => {
  it('accepts a matching Bearer secret', () => {
    const request = new Request('http://localhost/api/cron/daily-ingest', {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    })
    expect(isAuthorizedCronRequest(request)).toBe(true)
  })

  it('rejects a wrong secret', () => {
    const request = new Request('http://localhost/api/cron/daily-ingest', {
      headers: { Authorization: 'Bearer wrong-secret' },
    })
    expect(isAuthorizedCronRequest(request)).toBe(false)
  })

  it('rejects a missing Authorization header', () => {
    const request = new Request('http://localhost/api/cron/daily-ingest')
    expect(isAuthorizedCronRequest(request)).toBe(false)
  })

  it('rejects a header that is not Bearer-prefixed', () => {
    const request = new Request('http://localhost/api/cron/daily-ingest', {
      headers: { Authorization: env.CRON_SECRET },
    })
    expect(isAuthorizedCronRequest(request)).toBe(false)
  })
})

describe('GET /api/cron/daily-ingest', () => {
  it('returns 401 for a wrong secret', async () => {
    const request = new Request('http://localhost/api/cron/daily-ingest', {
      headers: { Authorization: 'Bearer wrong-secret' },
    })
    const response = await dailyIngestGET(request)
    expect(response.status).toBe(401)
  })

  it('returns 401 for a missing Authorization header', async () => {
    const request = new Request('http://localhost/api/cron/daily-ingest')
    const response = await dailyIngestGET(request)
    expect(response.status).toBe(401)
  })

  it('returns 200 with the ingest summary for a valid secret', async () => {
    const account = await seedAccount({ platform: 'twitch' })
    const request = new Request('http://localhost/api/cron/daily-ingest', {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    })

    const response = await dailyIngestGET(request)

    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<{ platform: string; ok: boolean }>
    expect(body).toEqual(expect.arrayContaining([{ platform: 'twitch', ok: true }]))
    void account
  })
})
