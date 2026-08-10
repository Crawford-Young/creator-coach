// @vitest-environment node
//
// runDailyIngest-level pin for design decision 3: an Analytics-endpoint
// failure must not cost an account its whole YouTube ingest. youtube.test.ts
// already asserts this one inference away, at syncChannel — this test
// exercises the REAL (unmocked) youtubeConnector through the actual
// runDailyIngest entry point, so the claim is pinned where it is made.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, type PlatformAccountDoc } from '@/db'
import { encryptToken } from '@/lib/token-crypto'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { runDailyIngest } from '@/lib/ingest/run-daily'
import channelFixture from '../../fixtures/youtube/channel.json'
import videoItemFixture from '../../fixtures/youtube/video-item.json'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'
const YOUTUBE_ANALYTICS_REPORTS_URL = 'https://youtubeanalytics.googleapis.com/v2/reports'
const SECONDS_TO_MS = 1000
const ANALYTICS_FORBIDDEN_STATUS = 403

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

function futureDate(secondsFromNow: number): Date {
  return new Date(Date.now() + secondsFromNow * SECONDS_TO_MS)
}

function uniqueId(label: string): string {
  return `${label}-${new ObjectId().toHexString()}`
}

// A per-run-unique plaintext token, deliberately NOT the 'current-access-token'
// literal every other real-connector test file's seedAccount() convention
// uses — runDailyIngest sweeps ALL 'active' accounts globally, including
// same-worker leftovers from earlier files in this run, and a shared literal
// would let this test's fetch mock also authenticate (and respond
// successfully to) a DIFFERENT account. That earlier account would then win
// this test's upserted content item (its `{platform, externalId}` filter
// carries no creatorId), leaving this test's own query empty.
function uniqueAccessToken(): string {
  return uniqueId('access-token')
}

async function seedYoutubeAccount(accessTokenPlaintext: string): Promise<PlatformAccountDoc> {
  const doc: PlatformAccountDoc = {
    _id: new ObjectId(),
    creatorId: new ObjectId().toHexString(),
    platform: 'youtube',
    externalId: uniqueId('yt-ext'),
    handle: 'YouTuber',
    accessToken: encryptToken(accessTokenPlaintext),
    refreshToken: encryptToken(uniqueId('refresh-token')),
    tokenExpiresAt: futureDate(3600),
    scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    status: 'active',
    linkedAt: new Date(),
  }
  await collections().platformAccounts.insertOne(doc)
  return doc
}

let createdAccount: PlatformAccountDoc | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.mocked(Sentry.captureException).mockClear()
  if (createdAccount) {
    const { platformAccounts, contentItems, metricSnapshots } = collections()
    await Promise.all([
      platformAccounts.deleteOne({ _id: createdAccount._id }),
      contentItems.deleteMany({ creatorId: createdAccount.creatorId }),
      metricSnapshots.deleteMany({ 'meta.creatorId': createdAccount.creatorId }),
    ])
    createdAccount = undefined
  }
})

describe('runDailyIngest — YouTube analytics isolation (design decision 3)', () => {
  it('completes the whole account (channel row, content item, item metrics) when the Analytics endpoint 403s', async () => {
    const accessTokenPlaintext = uniqueAccessToken()
    const account = await seedYoutubeAccount(accessTokenPlaintext)
    createdAccount = account
    // runDailyIngest scans ALL status:'active' accounts globally (same
    // shared-memory-server convention as run-daily.test.ts), so this file's
    // fetch mock WILL also receive requests from leftover 'active' accounts
    // seeded by other test files. Gating every response on THIS account's own
    // (per-run-unique) bearer token keeps every other account's requests
    // falling through to the generic throw below, isolated by runIsolated,
    // with no risk of colliding with this test's writes.
    const videoId = uniqueId('vid')

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = String(url)
      const headers = init?.headers as Record<string, string> | undefined
      const isThisAccount = headers?.Authorization === `Bearer ${accessTokenPlaintext}`
      if (isThisAccount && urlStr.startsWith(YOUTUBE_ANALYTICS_REPORTS_URL)) {
        return jsonResponse({ error: 'insufficientPermissions' }, ANALYTICS_FORBIDDEN_STATUS)
      }
      if (isThisAccount && urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        return jsonResponse(channelFixture)
      }
      if (isThisAccount && urlStr.startsWith(`${YOUTUBE_API_BASE}/playlistItems`)) {
        return jsonResponse({ items: [{ snippet: { resourceId: { videoId } } }] })
      }
      if (isThisAccount && urlStr.startsWith(`${YOUTUBE_API_BASE}/videos`)) {
        return jsonResponse({ items: [{ ...videoItemFixture, id: videoId }] })
      }
      throw new Error(`unexpected fetch call (not this test's account): ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const summary = await runDailyIngest()

    expect(summary.some((row) => row.platform === 'youtube' && row.ok === true)).toBe(true)

    const { metricSnapshots, contentItems } = collections()

    // syncChannel's own (non-analytics) write landed.
    const channelRow = await metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      'meta.scope': 'channel',
    })
    expect(channelRow?.metrics.subscribers).toBe(12345)

    // syncContent ran to completion — ingestAccount did not abort between
    // syncChannel and syncContent.
    const contentItem = await contentItems.findOne({
      creatorId: account.creatorId,
      platform: 'youtube',
      externalId: videoId,
    })
    expect(contentItem).not.toBeNull()

    // syncMetrics ran too — the full ingestAccount pipeline completed.
    const itemMetrics = await metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      'meta.scope': 'item',
      'meta.itemExternalId': videoId,
    })
    expect(itemMetrics).not.toBeNull()

    // The 403 genuinely happened and was reported, not silently discarded.
    const capturedStatuses = vi
      .mocked(Sentry.captureException)
      .mock.calls.map(([error]) => (error as { status?: number }).status)
    expect(capturedStatuses).toContain(ANALYTICS_FORBIDDEN_STATUS)
  })
})
