// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, type ContentItemDoc, type PlatformAccountDoc } from '@/db'
import { encryptToken } from '@/lib/token-crypto'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { YoutubeApiError, youtubeConnector } from '@/lib/connectors/youtube'

import channelFixture from '../../fixtures/youtube/channel.json'
import playlistPage1Fixture from '../../fixtures/youtube/playlist-items-page1.json'
import playlistPage2Fixture from '../../fixtures/youtube/playlist-items-page2.json'
import videoItemFixture from '../../fixtures/youtube/video-item.json'
import videoItemDisabledCountsFixture from '../../fixtures/youtube/video-item-disabled-counts.json'
import videoItemMalformedFixture from '../../fixtures/youtube/video-item-malformed.json'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'
const SECONDS_TO_MS = 1000

function futureDate(secondsFromNow: number): Date {
  return new Date(Date.now() + secondsFromNow * SECONDS_TO_MS)
}

function uniqueId(label: string): string {
  return `${label}-${new ObjectId().toHexString()}`
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

function seedContentItem(overrides: Partial<ContentItemDoc> = {}): ContentItemDoc {
  return {
    _id: new ObjectId(),
    creatorId: new ObjectId().toHexString(),
    platform: 'youtube',
    type: 'video',
    externalId: uniqueId('vid'),
    title: 'Seeded content item',
    publishedAt: new Date(),
    url: 'https://www.youtube.com/watch?v=seeded',
    raw: {},
    firstSeenAt: new Date(),
    lastSyncAt: new Date(),
    ...overrides,
  }
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

function idsFromUrl(urlStr: string): string[] {
  return (new URL(urlStr).searchParams.get('id') ?? '').split(',').filter(Boolean)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(Sentry.captureException).mockClear()
})

describe('syncChannel', () => {
  it('inserts a channel-scope snapshot with string counts coerced to numbers and caches uploadsPlaylistId', async () => {
    const account = await seedAccount()
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe(
        `${YOUTUBE_API_BASE}/channels?part=statistics,contentDetails&mine=true`,
      )
      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer current-access-token')
      return jsonResponse(channelFixture)
    })
    vi.stubGlobal('fetch', fetchMock)

    await youtubeConnector.syncChannel(account)

    const snapshot = await collections().metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      'meta.scope': 'channel',
    })
    expect(snapshot).not.toBeNull()
    expect(snapshot?.metrics.subscribers).toBe(12345)
    expect(snapshot?.metrics.views).toBe(987654)

    const updatedAccount = await collections().platformAccounts.findOne({ _id: account._id })
    expect(updatedAccount?.uploadsPlaylistId).toBe('UUfixtureUploadsPlaylistId')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws when the channels.list envelope is malformed', async () => {
    const account = await seedAccount()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ notItems: [] })),
    )

    await expect(youtubeConnector.syncChannel(account)).rejects.toThrow()
  })
})

describe('syncContent — pagination', () => {
  it('walks nextPageToken across two playlistItems pages and collects every video id', async () => {
    const account = await seedAccount({ uploadsPlaylistId: 'UUpaginationTest' })
    let playlistCallCount = 0
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/playlistItems`)) {
        playlistCallCount += 1
        if (playlistCallCount === 1) {
          expect(urlStr).not.toContain('pageToken=')
          return jsonResponse(playlistPage1Fixture)
        }
        expect(urlStr).toContain('pageToken=PAGE2TOKEN')
        return jsonResponse(playlistPage2Fixture)
      }
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/videos`)) {
        const ids = idsFromUrl(urlStr)
        return jsonResponse({ items: ids.map((id) => ({ ...videoItemFixture, id })) })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await youtubeConnector.syncContent(account)

    expect(playlistCallCount).toBe(2)
    const count = await collections().contentItems.countDocuments({
      platform: 'youtube',
      externalId: { $in: ['vid001', 'vid002', 'vid003'] },
    })
    expect(count).toBe(3)
  })

  it('throws when the playlistItems envelope is malformed', async () => {
    const account = await seedAccount({ uploadsPlaylistId: uniqueId('UUmalformedEnvelope') })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ notItems: [] })),
    )

    await expect(youtubeConnector.syncContent(account)).rejects.toThrow()
  })
})

describe('syncContent — uncached uploads playlist id', () => {
  it('resolves the playlist id via channels.list when the account has none cached, then caches it', async () => {
    const account = await seedAccount()
    expect(account.uploadsPlaylistId).toBeUndefined()
    const videoId = uniqueId('uncached')
    let channelsCallCount = 0
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/channels`)) {
        channelsCallCount += 1
        return jsonResponse(channelFixture)
      }
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/playlistItems`)) {
        expect(urlStr).toContain(
          `playlistId=${channelFixture.items[0].contentDetails.relatedPlaylists.uploads}`,
        )
        return jsonResponse({ items: [{ snippet: { resourceId: { videoId } } }] })
      }
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/videos`)) {
        // Empty thumbnails record exercises bestThumbnailUrl's "present but
        // no matching quality key" branch, distinct from "absent entirely"
        // (covered elsewhere) and "high available" (videoItemFixture).
        return jsonResponse({
          items: [
            {
              ...videoItemFixture,
              id: videoId,
              snippet: { ...videoItemFixture.snippet, thumbnails: {} },
            },
          ],
        })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await youtubeConnector.syncContent(account)

    expect(channelsCallCount).toBe(1)
    const updatedAccount = await collections().platformAccounts.findOne({ _id: account._id })
    expect(updatedAccount?.uploadsPlaylistId).toBe('UUfixtureUploadsPlaylistId')
    const contentItem = await collections().contentItems.findOne({
      platform: 'youtube',
      externalId: videoId,
    })
    expect(contentItem?.thumbnailUrl).toBeUndefined()
  })
})

describe('syncContent — batching', () => {
  const BATCH_TEST_VIDEO_COUNT = 60
  const FIRST_BATCH_SIZE = 50
  const SECOND_BATCH_SIZE = 10

  it('batches videos.list at 50 ids per call for a 60-video channel', async () => {
    const account = await seedAccount({ uploadsPlaylistId: uniqueId('UUbatchTest') })
    const runToken = uniqueId('batch')
    const videoIds = Array.from(
      { length: BATCH_TEST_VIDEO_COUNT },
      (_, i) => `${runToken}-${String(i).padStart(3, '0')}`,
    )
    const playlistItemsFixture = {
      items: videoIds.map((videoId) => ({ snippet: { resourceId: { videoId } } })),
    }
    const videosCalls: string[][] = []
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/playlistItems`)) {
        return jsonResponse(playlistItemsFixture)
      }
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/videos`)) {
        const ids = idsFromUrl(urlStr)
        videosCalls.push(ids)
        return jsonResponse({ items: ids.map((id) => ({ ...videoItemFixture, id })) })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await youtubeConnector.syncContent(account)

    expect(videosCalls).toHaveLength(2)
    expect(videosCalls[0]).toHaveLength(FIRST_BATCH_SIZE)
    expect(videosCalls[1]).toHaveLength(SECOND_BATCH_SIZE)
  })
})

describe('syncMetrics — disabled counts', () => {
  it('omits likes/comments keys entirely when the API field is absent (never zero)', async () => {
    const account = await seedAccount()
    const videoId = uniqueId('disabled-counts')
    const contentItem = seedContentItem({ creatorId: account.creatorId, externalId: videoId })
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      expect(urlStr.startsWith(`${YOUTUBE_API_BASE}/videos`)).toBe(true)
      return jsonResponse({ items: [{ ...videoItemDisabledCountsFixture, id: videoId }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await youtubeConnector.syncMetrics(account, [contentItem])

    const snapshot = await collections().metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      'meta.scope': 'item',
      'meta.itemExternalId': videoId,
    })
    expect(snapshot).not.toBeNull()
    expect(snapshot?.metrics.views).toBe(500)
    expect('likes' in (snapshot?.metrics ?? {})).toBe(false)
    expect('comments' in (snapshot?.metrics ?? {})).toBe(false)
  })

  it('skips a content item whose video is missing from the videos.list response', async () => {
    const account = await seedAccount()
    const presentId = uniqueId('present')
    const missingId = uniqueId('missing')
    const present = seedContentItem({ creatorId: account.creatorId, externalId: presentId })
    const missing = seedContentItem({ creatorId: account.creatorId, externalId: missingId })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [{ ...videoItemFixture, id: presentId }] })),
    )

    await youtubeConnector.syncMetrics(account, [present, missing])

    const presentSnapshot = await collections().metricSnapshots.findOne({
      'meta.itemExternalId': presentId,
    })
    const missingSnapshot = await collections().metricSnapshots.findOne({
      'meta.itemExternalId': missingId,
    })
    expect(presentSnapshot).not.toBeNull()
    expect(missingSnapshot).toBeNull()
  })

  it('throws when the videos.list envelope is malformed', async () => {
    const account = await seedAccount()
    const contentItem = seedContentItem({ creatorId: account.creatorId })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ notItems: [] })),
    )

    await expect(youtubeConnector.syncMetrics(account, [contentItem])).rejects.toThrow()
  })
})

describe('401 handling', () => {
  it('forces a token refresh and retries once on 401, then succeeds', async () => {
    const account = await seedAccount()
    let channelsCallCount = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = String(url)
      if (init?.method === 'POST') {
        expect(urlStr).toBe(GOOGLE_TOKEN_URL)
        return jsonResponse(tokenRefreshResponse())
      }
      channelsCallCount += 1
      if (channelsCallCount === 1) {
        return jsonResponse({ error: 'unauthorized' }, 401)
      }
      const headers = init?.headers as Record<string, string> | undefined
      expect(headers?.Authorization).toBe('Bearer refreshed-access-token')
      return jsonResponse(channelFixture)
    })
    vi.stubGlobal('fetch', fetchMock)

    await youtubeConnector.syncChannel(account)

    expect(channelsCallCount).toBe(2)
    const snapshot = await collections().metricSnapshots.findOne({
      'meta.creatorId': account.creatorId,
      'meta.scope': 'channel',
    })
    expect(snapshot).not.toBeNull()
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

    await expect(youtubeConnector.syncChannel(account)).rejects.toThrow()
  })
})

describe('non-401 error responses', () => {
  const QUOTA_EXCEEDED_STATUS = 403

  it('throws a YoutubeApiError carrying the status on a non-401 error from the initial call', async () => {
    const account = await seedAccount()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'quotaExceeded' }, QUOTA_EXCEEDED_STATUS)),
    )

    let caught: unknown
    try {
      await youtubeConnector.syncChannel(account)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(YoutubeApiError)
    expect((caught as YoutubeApiError).status).toBe(QUOTA_EXCEEDED_STATUS)
  })

  it('throws a YoutubeApiError carrying the status on a non-401 error from the post-401-retry call', async () => {
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
      await youtubeConnector.syncChannel(account)
    } catch (error) {
      caught = error
    }
    expect(channelsCallCount).toBe(2)
    expect(caught).toBeInstanceOf(YoutubeApiError)
    expect((caught as YoutubeApiError).status).toBe(QUOTA_EXCEEDED_STATUS)
  })
})

describe('unparseable duration', () => {
  it('reports an unparseable ISO-8601 duration to Sentry and skips that item while siblings land', async () => {
    const account = await seedAccount({ uploadsPlaylistId: uniqueId('UUbadDuration') })
    const goodId = uniqueId('good-duration')
    const badId = uniqueId('bad-duration')
    const playlistItemsFixture = {
      items: [
        { snippet: { resourceId: { videoId: goodId } } },
        { snippet: { resourceId: { videoId: badId } } },
      ],
    }
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/playlistItems`)) {
        return jsonResponse(playlistItemsFixture)
      }
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/videos`)) {
        return jsonResponse({
          items: [
            { ...videoItemFixture, id: goodId },
            {
              ...videoItemFixture,
              id: badId,
              contentDetails: { duration: 'not-a-duration' },
            },
          ],
        })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await youtubeConnector.syncContent(account)

    expect(Sentry.captureException).toHaveBeenCalled()
    const good = await collections().contentItems.findOne({
      platform: 'youtube',
      externalId: goodId,
    })
    const bad = await collections().contentItems.findOne({ platform: 'youtube', externalId: badId })
    expect(good).not.toBeNull()
    expect(bad).toBeNull()
  })
})

describe('malformed items', () => {
  it('reports a malformed video item to Sentry and skips it while siblings land', async () => {
    const account = await seedAccount({ uploadsPlaylistId: uniqueId('UUmalformedTest') })
    const goodId = uniqueId('good')
    const badId = uniqueId('bad')
    const playlistItemsFixture = {
      items: [
        { snippet: { resourceId: { videoId: goodId } } },
        { snippet: { resourceId: { videoId: badId } } },
      ],
    }
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/playlistItems`)) {
        return jsonResponse(playlistItemsFixture)
      }
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/videos`)) {
        return jsonResponse({
          items: [
            { ...videoItemFixture, id: goodId },
            { ...videoItemMalformedFixture, id: badId },
          ],
        })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await youtubeConnector.syncContent(account)

    expect(Sentry.captureException).toHaveBeenCalled()
    const good = await collections().contentItems.findOne({
      platform: 'youtube',
      externalId: goodId,
    })
    const bad = await collections().contentItems.findOne({ platform: 'youtube', externalId: badId })
    expect(good).not.toBeNull()
    expect(bad).toBeNull()
  })

  it('reports a malformed playlistItems entry to Sentry and skips it', async () => {
    const account = await seedAccount({ uploadsPlaylistId: uniqueId('UUmalformedPlaylistItem') })
    const goodId = uniqueId('good-pl')
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/playlistItems`)) {
        return jsonResponse({
          items: [{ snippet: { resourceId: { videoId: goodId } } }, { snippet: {} }],
        })
      }
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/videos`)) {
        const ids = idsFromUrl(urlStr)
        return jsonResponse({ items: ids.map((id) => ({ ...videoItemFixture, id })) })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await youtubeConnector.syncContent(account)

    expect(Sentry.captureException).toHaveBeenCalled()
    const good = await collections().contentItems.findOne({
      platform: 'youtube',
      externalId: goodId,
    })
    expect(good).not.toBeNull()
  })
})

describe('syncContent re-run', () => {
  it('does not create duplicate contentItems on a second run', async () => {
    const account = await seedAccount({ uploadsPlaylistId: uniqueId('UUreRunTest') })
    const videoId = uniqueId('rerun')
    const playlistItemsFixture = {
      items: [{ snippet: { resourceId: { videoId } } }],
    }
    const fetchMock = vi.fn(async (url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/playlistItems`)) {
        return jsonResponse(playlistItemsFixture)
      }
      if (urlStr.startsWith(`${YOUTUBE_API_BASE}/videos`)) {
        // No thumbnails on this fixture — exercises the "no thumbnail
        // available" branch of syncContent's upsert alongside the
        // "has thumbnail" branch already covered by videoItemFixture.
        return jsonResponse({
          items: [{ ...videoItemDisabledCountsFixture, id: videoId }],
        })
      }
      throw new Error(`unexpected fetch url: ${urlStr}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await youtubeConnector.syncContent(account)
    await youtubeConnector.syncContent(account)

    const count = await collections().contentItems.countDocuments({
      platform: 'youtube',
      externalId: videoId,
    })
    expect(count).toBe(1)
  })
})

describe('request shape', () => {
  it('sends Authorization: Bearer, never puts the token in the URL, and never calls search.list', async () => {
    const account = await seedAccount()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = String(url)
      expect(urlStr).not.toContain('current-access-token')
      expect(urlStr).not.toContain('search')
      const headers = init?.headers as Record<string, string> | undefined
      expect(headers?.Authorization).toBe('Bearer current-access-token')
      return jsonResponse(channelFixture)
    })
    vi.stubGlobal('fetch', fetchMock)

    await youtubeConnector.syncChannel(account)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
