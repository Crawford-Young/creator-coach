// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, ensureTimeseries, type ContentItemDoc, type PlatformAccountDoc } from '@/db'
import { decryptToken, encryptToken } from '@/lib/token-crypto'
import { env } from '@/env'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import {
  twitchConnector,
  checkLive,
  TwitchApiError,
  TwitchValidationError,
  TwitchRateLimitError,
  __setSleepForTesting,
} from '@/lib/connectors/twitch'

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'twitch')
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate'
const HELIX_BASE = 'https://api.twitch.tv/helix'
const BROADCASTER_ID = 'bcaster123'
const SECONDS_TO_MS = 1000

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8'))
}

/**
 * The (platform, externalId) index is globally unique and this suite never
 * wipes collections, so tests that insert a contentItems doc directly (not
 * via the connector's own upsert) need externalIds no other test in the
 * file has used. This clones a list-envelope fixture with its single item's
 * `id` swapped to the caller's unique value, keeping every other field.
 */
function fixtureWithId(name: string, id: string): unknown {
  const clone = fixture(name) as { data: Array<Record<string, unknown>> }
  if (clone.data[0]) clone.data[0]!.id = id
  return clone
}

/** Synthetic Get Videos id-batch response for the >100-item chunking test. */
function makeVideosResponse(ids: string[]): unknown {
  return {
    data: ids.map((id, index) => ({
      id,
      title: `Video ${id}`,
      url: `https://www.twitch.tv/videos/${id}`,
      thumbnail_url: `https://example.com/${id}.jpg`,
      view_count: index,
      published_at: '2026-08-01T00:00:00Z',
    })),
    pagination: {},
  }
}

interface RouteFixture {
  ok?: boolean
  status?: number
  headers?: Record<string, string>
  body?: unknown
}

interface FetchRouter {
  fetchMock: ReturnType<typeof vi.fn>
  queue: (url: string, response: RouteFixture) => void
}

function createFetchRouter(): FetchRouter {
  const routes = new Map<string, RouteFixture[]>()
  const fetchMock = vi.fn(async (url: string) => {
    const list = routes.get(url)
    if (!list || list.length === 0) {
      throw new Error(`unexpected fetch call with no queued response: ${url}`)
    }
    const response = list.shift()!
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      headers: { get: (name: string) => response.headers?.[name] ?? null },
      json: async () => response.body,
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    queue: (url, response) => {
      const list = routes.get(url) ?? []
      list.push(response)
      routes.set(url, list)
    },
  }
}

function queueValidateOk(router: FetchRouter): void {
  router.queue(VALIDATE_URL, { ok: true, body: {} })
}

async function seedAccount(
  overrides: Partial<PlatformAccountDoc> = {},
): Promise<PlatformAccountDoc> {
  const doc: PlatformAccountDoc = {
    _id: new ObjectId(),
    creatorId: new ObjectId().toHexString(),
    platform: 'twitch',
    externalId: BROADCASTER_ID,
    handle: 'Bcaster',
    accessToken: encryptToken('current-access-token'),
    refreshToken: encryptToken('current-refresh-token'),
    tokenExpiresAt: new Date(Date.now() + 3600 * SECONDS_TO_MS),
    scopes: ['channel:read:subscriptions', 'moderator:read:followers'],
    status: 'active',
    linkedAt: new Date(),
    ...overrides,
  }
  await collections().platformAccounts.insertOne(doc)
  return doc
}

async function seedContentItem(
  creatorId: string,
  overrides: Partial<ContentItemDoc> = {},
): Promise<ContentItemDoc> {
  const doc: ContentItemDoc = {
    _id: new ObjectId(),
    creatorId,
    platform: 'twitch',
    type: 'vod',
    externalId: 'vod-1',
    title: 'VOD One',
    publishedAt: new Date('2026-08-01T12:05:00Z'),
    url: 'https://www.twitch.tv/videos/vod-1',
    raw: {},
    firstSeenAt: new Date(),
    lastSyncAt: new Date(),
    ...overrides,
  }
  await collections().contentItems.insertOne(doc)
  return doc
}

// metricSnapshots is a native time-series collection (src/db/index.ts) that
// must exist BEFORE any insertOne — an insert into a not-yet-created
// collection auto-creates it as a plain collection, which then makes any
// concurrent test file's ensureTimeseries() fail with "already exists".
// Vitest runs test files in parallel workers with no guaranteed order, so
// this must not rely on another file (db-model.test.ts) winning the race.
//
// ensureTimeseries() itself has a check-then-create race (src/db/index.ts,
// out of this task's scope) when two files call it concurrently — tolerate
// "already exists" here: it means a concurrent caller already created it,
// which is exactly what this beforeAll wants.
beforeAll(async () => {
  try {
    await ensureTimeseries()
  } catch (error) {
    const isNamespaceExists = error instanceof Error && /already exists/i.test(error.message)
    if (!isNamespaceExists) throw error
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(Sentry.captureException).mockClear()
})

describe('syncChannel', () => {
  it('happy path: inserts one channel-scope snapshot with followers/subscribers/subPoints', async () => {
    const account = await seedAccount()
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/channels/followers?broadcaster_id=${BROADCASTER_ID}&first=1`, {
      body: fixture('followers'),
    })
    router.queue(`${HELIX_BASE}/subscriptions?broadcaster_id=${BROADCASTER_ID}&first=1`, {
      body: fixture('subscriptions'),
    })

    await twitchConnector.syncChannel(account)

    const snapshots = await collections()
      .metricSnapshots.find({ 'meta.creatorId': account.creatorId, 'meta.scope': 'channel' })
      .toArray()
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]!.meta).toEqual({
      creatorId: account.creatorId,
      platform: 'twitch',
      scope: 'channel',
    })
    expect(snapshots[0]!.metrics).toEqual({ followers: 42, subscribers: 7, subPoints: 8 })
    expect(snapshots[0]!.capturedAt).toBeInstanceOf(Date)
  })

  it('request shape: validate uses OAuth header, helix calls use Bearer + Client-Id, no secret in any URL', async () => {
    const account = await seedAccount()
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/channels/followers?broadcaster_id=${BROADCASTER_ID}&first=1`, {
      body: fixture('followers'),
    })
    router.queue(`${HELIX_BASE}/subscriptions?broadcaster_id=${BROADCASTER_ID}&first=1`, {
      body: fixture('subscriptions'),
    })

    await twitchConnector.syncChannel(account)

    const calls = router.fetchMock.mock.calls as [string, RequestInit][]
    const [validateUrl, validateInit] = calls[0]!
    expect(validateUrl).toBe(VALIDATE_URL)
    expect((validateInit.headers as Record<string, string>).Authorization).toBe(
      'OAuth current-access-token',
    )
    expect(validateUrl).not.toContain(env.AUTH_TWITCH_SECRET)

    const [followersUrl, followersInit] = calls[1]!
    expect(followersUrl).not.toContain(env.AUTH_TWITCH_SECRET)
    const followersHeaders = followersInit.headers as Record<string, string>
    expect(followersHeaders.Authorization).toBe('Bearer current-access-token')
    expect(followersHeaders['Client-Id']).toBe(env.AUTH_TWITCH_ID)
  })
})

describe('syncContent', () => {
  it('happy path: upserts vod and clip content items with correct fields', async () => {
    const account = await seedAccount()
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/videos?user_id=${BROADCASTER_ID}&type=archive&first=100`, {
      body: fixture('videos-page1'),
    })
    router.queue(
      `${HELIX_BASE}/videos?user_id=${BROADCASTER_ID}&type=archive&first=100&after=page2cursor`,
      { body: fixture('videos-page2') },
    )
    router.queue(`${HELIX_BASE}/clips?broadcaster_id=${BROADCASTER_ID}&first=100`, {
      body: fixture('clips-page1'),
    })

    await twitchConnector.syncContent(account)

    const vod = await collections().contentItems.findOne({
      platform: 'twitch',
      externalId: 'vod-1',
    })
    expect(vod).not.toBeNull()
    expect(vod!.type).toBe('vod')
    expect(vod!.title).toBe('VOD One')
    expect(vod!.url).toBe('https://www.twitch.tv/videos/vod-1')
    expect(vod!.thumbnailUrl).toBe('https://example.com/vod-1.jpg')
    expect(vod!.publishedAt).toEqual(new Date('2026-08-01T12:05:00Z'))
    expect(vod!.creatorId).toBe(account.creatorId)
    expect(vod!.durationSec).toBeUndefined()
    expect(vod!.raw).toMatchObject({ id: 'vod-1', duration: '1h2m3s' })
    expect(vod!.firstSeenAt).toBeInstanceOf(Date)
    expect(vod!.lastSyncAt).toBeInstanceOf(Date)

    const clip = await collections().contentItems.findOne({
      platform: 'twitch',
      externalId: 'clip-1',
    })
    expect(clip).not.toBeNull()
    expect(clip!.type).toBe('clip')
    expect(clip!.title).toBe('Great Clip')
    expect(clip!.publishedAt).toEqual(new Date('2026-08-03T12:00:00Z'))
    expect(clip!.raw).toMatchObject({ id: 'clip-1', duration: 22.5 })
  })

  it('pagination: 2-page VOD fixture passes the cursor via after= and upserts both pages', async () => {
    const account = await seedAccount()
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/videos?user_id=${BROADCASTER_ID}&type=archive&first=100`, {
      body: fixture('videos-page1'),
    })
    router.queue(
      `${HELIX_BASE}/videos?user_id=${BROADCASTER_ID}&type=archive&first=100&after=page2cursor`,
      { body: fixture('videos-page2') },
    )
    router.queue(`${HELIX_BASE}/clips?broadcaster_id=${BROADCASTER_ID}&first=100`, {
      body: fixture('clips-empty'),
    })

    await twitchConnector.syncContent(account)

    const vod1 = await collections().contentItems.findOne({
      platform: 'twitch',
      externalId: 'vod-1',
    })
    const vod2 = await collections().contentItems.findOne({
      platform: 'twitch',
      externalId: 'vod-2',
    })
    expect(vod1).not.toBeNull()
    expect(vod2).not.toBeNull()
    expect(vod2!.title).toBe('VOD Two')
    // Confirms the second-page URL (with after=page2cursor) was actually
    // requested, not just queued.
    expect(router.fetchMock).toHaveBeenCalledWith(
      `${HELIX_BASE}/videos?user_id=${BROADCASTER_ID}&type=archive&first=100&after=page2cursor`,
      expect.anything(),
    )
  })

  it('clips pagination: 2-page clips fixture passes the cursor via after= and upserts both pages', async () => {
    const account = await seedAccount()
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/videos?user_id=${BROADCASTER_ID}&type=archive&first=100`, {
      body: fixture('videos-empty'),
    })
    router.queue(`${HELIX_BASE}/clips?broadcaster_id=${BROADCASTER_ID}&first=100`, {
      body: fixture('clips-page1-with-cursor'),
    })
    router.queue(
      `${HELIX_BASE}/clips?broadcaster_id=${BROADCASTER_ID}&first=100&after=clipsPage2cursor`,
      { body: fixture('clips-page2') },
    )

    await twitchConnector.syncContent(account)

    const clip1 = await collections().contentItems.findOne({
      platform: 'twitch',
      externalId: 'clip-1',
    })
    const clip2 = await collections().contentItems.findOne({
      platform: 'twitch',
      externalId: 'clip-2',
    })
    expect(clip1).not.toBeNull()
    expect(clip2).not.toBeNull()
    expect(clip2!.title).toBe('Another Great Clip')
  })

  it('malformed item in the list is skipped (Sentry called), well-formed siblings still land', async () => {
    const account = await seedAccount()
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/videos?user_id=${BROADCASTER_ID}&type=archive&first=100`, {
      body: fixture('videos-malformed'),
    })
    router.queue(`${HELIX_BASE}/clips?broadcaster_id=${BROADCASTER_ID}&first=100`, {
      body: fixture('clips-empty'),
    })

    await twitchConnector.syncContent(account)

    const good = await collections().contentItems.findOne({
      platform: 'twitch',
      externalId: 'vod-good',
    })
    expect(good).not.toBeNull()
    const bad = await collections().contentItems.findOne({
      platform: 'twitch',
      externalId: 'vod-bad',
    })
    expect(bad).toBeNull()
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('re-running syncContent on the same fixtures does not create duplicate contentItems', async () => {
    const account = await seedAccount()

    for (let i = 0; i < 2; i += 1) {
      const router = createFetchRouter()
      queueValidateOk(router)
      router.queue(`${HELIX_BASE}/videos?user_id=${BROADCASTER_ID}&type=archive&first=100`, {
        body: fixture('videos-page1'),
      })
      router.queue(
        `${HELIX_BASE}/videos?user_id=${BROADCASTER_ID}&type=archive&first=100&after=page2cursor`,
        { body: fixture('videos-page2') },
      )
      router.queue(`${HELIX_BASE}/clips?broadcaster_id=${BROADCASTER_ID}&first=100`, {
        body: fixture('clips-page1'),
      })
      await twitchConnector.syncContent(account)
      vi.unstubAllGlobals()
    }

    const vodCount = await collections().contentItems.countDocuments({
      platform: 'twitch',
      externalId: 'vod-1',
    })
    const clipCount = await collections().contentItems.countDocuments({
      platform: 'twitch',
      externalId: 'clip-1',
    })
    expect(vodCount).toBe(1)
    expect(clipCount).toBe(1)
  })

  it('includes started_at (lastSyncAt minus one day) on the clips request when account.lastSyncAt is set', async () => {
    const lastSyncAt = new Date('2026-08-05T00:00:00.000Z')
    const account = await seedAccount({ lastSyncAt })
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/videos?user_id=${BROADCASTER_ID}&type=archive&first=100`, {
      body: fixture('videos-empty'),
    })
    const expectedStartedAt = new Date(
      lastSyncAt.getTime() - 24 * 60 * 60 * SECONDS_TO_MS,
    ).toISOString()
    router.queue(
      `${HELIX_BASE}/clips?broadcaster_id=${BROADCASTER_ID}&first=100&started_at=${encodeURIComponent(expectedStartedAt)}`,
      { body: fixture('clips-empty') },
    )

    await expect(twitchConnector.syncContent(account)).resolves.toBeUndefined()
  })
})

describe('syncMetrics', () => {
  it('happy path: fetches current view_count for vod + clip items and inserts item-scope snapshots', async () => {
    const account = await seedAccount()
    const vodExternalId = `vod-metrics-${account.creatorId}`
    const clipExternalId = `clip-metrics-${account.creatorId}`
    const vodItem = await seedContentItem(account.creatorId, {
      type: 'vod',
      externalId: vodExternalId,
    })
    const clipItem = await seedContentItem(account.creatorId, {
      type: 'clip',
      externalId: clipExternalId,
      title: 'Great Clip',
      url: 'https://clips.twitch.tv/clip-1',
    })
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/videos?id=${vodExternalId}`, {
      body: fixtureWithId('videos-metrics', vodExternalId),
    })
    router.queue(`${HELIX_BASE}/clips?id=${clipExternalId}`, {
      body: fixtureWithId('clips-metrics', clipExternalId),
    })

    await twitchConnector.syncMetrics(account, [vodItem, clipItem])

    const vodSnapshot = await collections().metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      'meta.scope': 'item',
      'meta.itemExternalId': vodExternalId,
    })
    expect(vodSnapshot?.metrics).toEqual({ views: 1234 })
    const clipSnapshot = await collections().metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      'meta.scope': 'item',
      'meta.itemExternalId': clipExternalId,
    })
    expect(clipSnapshot?.metrics).toEqual({ views: 567 })
  })

  it('chunks id batches into HELIX_PAGE_SIZE (100) groups when items exceed the Twitch id= cap', async () => {
    const account = await seedAccount()
    const ITEM_COUNT = 150
    const CHUNK_SIZE = 100
    const items: ContentItemDoc[] = []
    for (let i = 0; i < ITEM_COUNT; i += 1) {
      const externalId = `vod-batch-${account.creatorId}-${i}`
      items.push(await seedContentItem(account.creatorId, { type: 'vod', externalId }))
    }

    const chunk1 = items.slice(0, CHUNK_SIZE)
    const chunk2 = items.slice(CHUNK_SIZE)

    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(
      `${HELIX_BASE}/videos?${chunk1.map((item) => `id=${item.externalId}`).join('&')}`,
      { body: makeVideosResponse(chunk1.map((item) => item.externalId)) },
    )
    router.queue(
      `${HELIX_BASE}/videos?${chunk2.map((item) => `id=${item.externalId}`).join('&')}`,
      { body: makeVideosResponse(chunk2.map((item) => item.externalId)) },
    )

    await twitchConnector.syncMetrics(account, items)

    const videoCalls = router.fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/videos'),
    )
    expect(videoCalls).toHaveLength(2)
    expect(String(videoCalls[0]![0])).toContain(`id=${chunk1[0]!.externalId}`)
    expect(String(videoCalls[0]![0])).not.toContain(`id=${chunk2[0]!.externalId}`)
    expect(String(videoCalls[1]![0])).toContain(`id=${chunk2[0]!.externalId}`)

    const snapshotCount = await collections().metricSnapshots.countDocuments({
      'meta.creatorId': account.creatorId,
      'meta.scope': 'item',
    })
    expect(snapshotCount).toBe(ITEM_COUNT)
  })

  it('clip-only items skip the vod batch fetch entirely', async () => {
    const account = await seedAccount()
    const clipExternalId = `clip-only-${account.creatorId}`
    const clipItem = await seedContentItem(account.creatorId, {
      type: 'clip',
      externalId: clipExternalId,
      title: 'Clip Only',
      url: 'https://clips.twitch.tv/clip-only',
    })
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/clips?id=${clipExternalId}`, {
      body: fixtureWithId('clips-metrics', clipExternalId),
    })

    await twitchConnector.syncMetrics(account, [clipItem])

    const snapshot = await collections().metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      'meta.itemExternalId': clipExternalId,
    })
    expect(snapshot?.metrics).toEqual({ views: 567 })
    expect(router.fetchMock.mock.calls.some((call) => String(call[0]).includes('/videos'))).toBe(
      false,
    )
  })

  it('an item not returned by the batch endpoint is skipped — no snapshot written for it', async () => {
    const account = await seedAccount()
    const vodItem = await seedContentItem(account.creatorId, {
      type: 'vod',
      externalId: 'vod-missing',
    })
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/videos?id=vod-missing`, { body: fixture('videos-empty') })

    await twitchConnector.syncMetrics(account, [vodItem])

    const snapshot = await collections().metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      'meta.itemExternalId': 'vod-missing',
    })
    expect(snapshot).toBeNull()
  })
})

describe('checkLive', () => {
  it('live: inserts a channel-scope snapshot with ccv = viewer_count', async () => {
    const account = await seedAccount()
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/streams?user_id=${BROADCASTER_ID}`, {
      body: fixture('streams-live'),
    })

    await checkLive(account)

    const snapshot = await collections().metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      'meta.scope': 'channel',
      'metrics.ccv': { $exists: true },
    })
    expect(snapshot?.metrics).toEqual({ ccv: 88 })
  })

  it('not live: writes zero snapshots', async () => {
    const account = await seedAccount()
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/streams?user_id=${BROADCASTER_ID}`, {
      body: fixture('streams-offline'),
    })

    const before = await collections().metricSnapshots.countDocuments({
      'meta.creatorId': account.creatorId,
    })
    await checkLive(account)
    const after = await collections().metricSnapshots.countDocuments({
      'meta.creatorId': account.creatorId,
    })
    expect(after).toBe(before)
  })
})

describe('token validation retry', () => {
  it('validate 401 forces a refresh and retries once, then succeeds', async () => {
    const account = await seedAccount({
      tokenExpiresAt: new Date(Date.now() + 3600 * SECONDS_TO_MS),
    })
    const router = createFetchRouter()
    router.queue(VALIDATE_URL, { ok: false, status: 401, body: {} })
    router.queue('https://id.twitch.tv/oauth2/token', {
      body: {
        access_token: 'rotated-access-token',
        expires_in: 14400,
        refresh_token: 'rotated-refresh-token',
        scope: 'channel:read:subscriptions',
        token_type: 'bearer',
      },
    })
    router.queue(VALIDATE_URL, { ok: true, body: {} })
    router.queue(`${HELIX_BASE}/streams?user_id=${BROADCASTER_ID}`, {
      body: fixture('streams-offline'),
    })

    await expect(checkLive(account)).resolves.toBeUndefined()

    const doc = await collections().platformAccounts.findOne({ _id: account._id })
    expect(decryptToken(doc!.accessToken)).toBe('rotated-access-token')
  })

  it('a second validate 401 after the forced refresh throws TwitchValidationError', async () => {
    const account = await seedAccount({
      tokenExpiresAt: new Date(Date.now() + 3600 * SECONDS_TO_MS),
    })
    const router = createFetchRouter()
    router.queue(VALIDATE_URL, { ok: false, status: 401, body: {} })
    router.queue('https://id.twitch.tv/oauth2/token', {
      body: {
        access_token: 'still-bad-access-token',
        expires_in: 14400,
        refresh_token: 'still-bad-refresh-token',
        scope: 'channel:read:subscriptions',
        token_type: 'bearer',
      },
    })
    router.queue(VALIDATE_URL, { ok: false, status: 401, body: {} })

    await expect(checkLive(account)).rejects.toThrow(TwitchValidationError)
  })
})

describe('rate limiting', () => {
  // Must run before any test calls __setSleepForTesting — this is the only
  // test exercising the module's REAL (untouched) sleep implementation, via
  // fake timers so there is no genuine wall-clock wait.
  it('the real (non-overridden) sleep implementation waits and resolves, verified via fake timers', async () => {
    vi.useFakeTimers()
    try {
      const account = await seedAccount()
      const router = createFetchRouter()
      queueValidateOk(router)
      const resetEpochSec = Math.floor(Date.now() / SECONDS_TO_MS) + 2
      router.queue(`${HELIX_BASE}/streams?user_id=${BROADCASTER_ID}`, {
        ok: false,
        status: 429,
        headers: { 'Ratelimit-Reset': String(resetEpochSec) },
        body: {},
      })
      router.queue(`${HELIX_BASE}/streams?user_id=${BROADCASTER_ID}`, {
        body: fixture('streams-offline'),
      })

      const pending = checkLive(account)
      await vi.advanceTimersByTimeAsync(3000)
      await expect(pending).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a 429 with no Ratelimit-Reset header still retries (treats the wait as immediate)', async () => {
    __setSleepForTesting(vi.fn().mockResolvedValue(undefined))
    const account = await seedAccount()
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/streams?user_id=${BROADCASTER_ID}`, {
      ok: false,
      status: 429,
      body: {},
    })
    router.queue(`${HELIX_BASE}/streams?user_id=${BROADCASTER_ID}`, {
      body: fixture('streams-offline'),
    })

    await expect(checkLive(account)).resolves.toBeUndefined()
  })

  it('429 waits per Ratelimit-Reset once, then succeeds', async () => {
    const sleepSpy = vi.fn().mockResolvedValue(undefined)
    __setSleepForTesting(sleepSpy)
    const account = await seedAccount()
    const router = createFetchRouter()
    queueValidateOk(router)
    const resetEpochSec = Math.floor(Date.now() / SECONDS_TO_MS) + 5
    router.queue(`${HELIX_BASE}/streams?user_id=${BROADCASTER_ID}`, {
      ok: false,
      status: 429,
      headers: { 'Ratelimit-Reset': String(resetEpochSec) },
      body: {},
    })
    router.queue(`${HELIX_BASE}/streams?user_id=${BROADCASTER_ID}`, {
      body: fixture('streams-offline'),
    })

    await expect(checkLive(account)).resolves.toBeUndefined()

    expect(sleepSpy).toHaveBeenCalledTimes(1)
    const waitedMs = sleepSpy.mock.calls[0]![0] as number
    expect(waitedMs).toBeGreaterThan(0)
    expect(waitedMs).toBeLessThanOrEqual(6000)
  })

  it('a non-429, non-OK helix response throws TwitchApiError', async () => {
    const account = await seedAccount()
    const router = createFetchRouter()
    queueValidateOk(router)
    router.queue(`${HELIX_BASE}/streams?user_id=${BROADCASTER_ID}`, {
      ok: false,
      status: 500,
      body: {},
    })

    await expect(checkLive(account)).rejects.toThrow(TwitchApiError)
  })

  it('a second 429 fails the run with TwitchRateLimitError', async () => {
    __setSleepForTesting(vi.fn().mockResolvedValue(undefined))
    const account = await seedAccount()
    const router = createFetchRouter()
    queueValidateOk(router)
    const resetEpochSec = Math.floor(Date.now() / SECONDS_TO_MS) + 5
    router.queue(`${HELIX_BASE}/streams?user_id=${BROADCASTER_ID}`, {
      ok: false,
      status: 429,
      headers: { 'Ratelimit-Reset': String(resetEpochSec) },
      body: {},
    })
    router.queue(`${HELIX_BASE}/streams?user_id=${BROADCASTER_ID}`, {
      ok: false,
      status: 429,
      headers: { 'Ratelimit-Reset': String(resetEpochSec) },
      body: {},
    })

    await expect(checkLive(account)).rejects.toThrow(TwitchRateLimitError)
  })
})
