import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'
import {
  collections,
  type ContentItemDoc,
  type MetricSnapshotDoc,
  type PlatformAccountDoc,
} from '@/db'
import { getFreshGoogleToken } from './token-refresh'
import { parseIsoDuration } from './iso-duration'
import type { PlatformConnector } from './types'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'
const HTTP_UNAUTHORIZED = 401

// A3 (doc-recon assumption, verify at backfill QA): the id-cap per
// videos.list call is undocumented — batch conservatively at 50.
const YT_VIDEOS_BATCH_SIZE = 50
const PLAYLIST_ITEMS_PAGE_SIZE = 50

// YouTube thumbnail keys ordered highest-to-lowest resolution — the first
// one present in a given response is the "best available" per video.
const THUMBNAIL_QUALITY_PRIORITY = ['maxres', 'standard', 'high', 'medium', 'default'] as const

export class YoutubeApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'YoutubeApiError'
    this.status = status
  }
}

const channelStatisticsSchema = z.object({
  subscriberCount: z.coerce.number(),
  viewCount: z.coerce.number(),
})

const channelItemSchema = z.object({
  statistics: channelStatisticsSchema,
  contentDetails: z.object({
    relatedPlaylists: z.object({
      uploads: z.string(),
    }),
  }),
})

const channelsResponseSchema = z.object({
  items: z.array(channelItemSchema).min(1),
})

const playlistItemsEnvelopeSchema = z.object({
  items: z.array(z.unknown()),
  nextPageToken: z.string().optional(),
})

const playlistItemSchema = z.object({
  snippet: z.object({
    resourceId: z.object({
      videoId: z.string(),
    }),
  }),
})

const thumbnailSchema = z.object({ url: z.string() })

const videoItemSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string(),
    publishedAt: z.string(),
    thumbnails: z.record(z.string(), thumbnailSchema).optional(),
  }),
  statistics: z.object({
    viewCount: z.coerce.number(),
    likeCount: z.coerce.number().optional(),
    commentCount: z.coerce.number().optional(),
  }),
  contentDetails: z.object({
    duration: z.string(),
  }),
})

const videosEnvelopeSchema = z.object({
  items: z.array(z.unknown()),
})

type ChannelItem = z.infer<typeof channelItemSchema>
type VideoItem = z.infer<typeof videoItemSchema>

function bearerHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

/**
 * GET a YouTube Data API URL, refreshing the account's Google token first.
 * On a 401, forces a refresh and retries the call exactly once — a second
 * 401 is a hard failure, not a retry loop.
 */
async function authorizedGet(account: PlatformAccountDoc, url: string): Promise<unknown> {
  const token = await getFreshGoogleToken(account)
  const response = await fetch(url, { headers: bearerHeaders(token.accessToken) })
  if (response.ok) {
    return response.json()
  }
  if (response.status !== HTTP_UNAUTHORIZED) {
    throw new YoutubeApiError(
      `YouTube API request failed with status ${response.status}: ${url}`,
      response.status,
    )
  }

  const refreshed = await getFreshGoogleToken(account, { forceRefresh: true })
  const retryResponse = await fetch(url, { headers: bearerHeaders(refreshed.accessToken) })
  if (retryResponse.ok) {
    return retryResponse.json()
  }
  if (retryResponse.status === HTTP_UNAUTHORIZED) {
    throw new YoutubeApiError(
      `YouTube API unauthorized after token refresh retry: ${url}`,
      retryResponse.status,
    )
  }
  throw new YoutubeApiError(
    `YouTube API request failed with status ${retryResponse.status}: ${url}`,
    retryResponse.status,
  )
}

async function fetchChannel(account: PlatformAccountDoc): Promise<ChannelItem> {
  const url = `${YOUTUBE_API_BASE}/channels?part=statistics,contentDetails&mine=true`
  const json = await authorizedGet(account, url)
  const parsed = channelsResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new YoutubeApiError('Malformed channels.list response envelope')
  }
  // channelsResponseSchema enforces items.min(1) — a successful parse
  // guarantees this index is present.
  return parsed.data.items[0]
}

async function resolveUploadsPlaylistId(account: PlatformAccountDoc): Promise<string> {
  if (account.uploadsPlaylistId) {
    return account.uploadsPlaylistId
  }
  const channel = await fetchChannel(account)
  const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads
  await collections().platformAccounts.updateOne(
    { _id: account._id },
    { $set: { uploadsPlaylistId } },
  )
  return uploadsPlaylistId
}

async function collectUploadedVideoIds(
  account: PlatformAccountDoc,
  playlistId: string,
): Promise<string[]> {
  const videoIds: string[] = []
  let pageToken: string | undefined

  do {
    const url = new URL(`${YOUTUBE_API_BASE}/playlistItems`)
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('playlistId', playlistId)
    url.searchParams.set('maxResults', String(PLAYLIST_ITEMS_PAGE_SIZE))
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const json = await authorizedGet(account, url.toString())
    const parsed = playlistItemsEnvelopeSchema.safeParse(json)
    if (!parsed.success) {
      throw new YoutubeApiError('Malformed playlistItems response envelope')
    }

    for (const rawItem of parsed.data.items) {
      const itemParsed = playlistItemSchema.safeParse(rawItem)
      if (!itemParsed.success) {
        Sentry.captureException(itemParsed.error)
        continue
      }
      videoIds.push(itemParsed.data.snippet.resourceId.videoId)
    }

    pageToken = parsed.data.nextPageToken
  } while (pageToken)

  return videoIds
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

async function fetchVideosBatch(account: PlatformAccountDoc, ids: string[]): Promise<VideoItem[]> {
  const url = `${YOUTUBE_API_BASE}/videos?part=snippet,statistics,contentDetails&id=${ids.join(',')}`
  const json = await authorizedGet(account, url)
  const parsed = videosEnvelopeSchema.safeParse(json)
  if (!parsed.success) {
    throw new YoutubeApiError('Malformed videos.list response envelope')
  }

  const videos: VideoItem[] = []
  for (const rawItem of parsed.data.items) {
    const itemParsed = videoItemSchema.safeParse(rawItem)
    if (!itemParsed.success) {
      Sentry.captureException(itemParsed.error)
      continue
    }
    videos.push(itemParsed.data)
  }
  return videos
}

async function fetchAllVideos(account: PlatformAccountDoc, ids: string[]): Promise<VideoItem[]> {
  const videos: VideoItem[] = []
  for (const batch of chunk(ids, YT_VIDEOS_BATCH_SIZE)) {
    videos.push(...(await fetchVideosBatch(account, batch)))
  }
  return videos
}

function bestThumbnailUrl(thumbnails: VideoItem['snippet']['thumbnails']): string | undefined {
  if (!thumbnails) {
    return undefined
  }
  for (const quality of THUMBNAIL_QUALITY_PRIORITY) {
    const thumbnail = thumbnails[quality]
    if (thumbnail) {
      return thumbnail.url
    }
  }
  return undefined
}

async function syncChannel(account: PlatformAccountDoc): Promise<void> {
  const channel = await fetchChannel(account)
  const { metricSnapshots, platformAccounts } = collections()

  await metricSnapshots.insertOne({
    capturedAt: new Date(),
    meta: {
      creatorId: account.creatorId,
      platform: 'youtube',
      scope: 'channel',
    },
    metrics: {
      subscribers: channel.statistics.subscriberCount,
      views: channel.statistics.viewCount,
    },
  })

  await platformAccounts.updateOne(
    { _id: account._id },
    { $set: { uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads } },
  )
}

async function syncContent(account: PlatformAccountDoc): Promise<void> {
  const playlistId = await resolveUploadsPlaylistId(account)
  const videoIds = await collectUploadedVideoIds(account, playlistId)
  const videos = await fetchAllVideos(account, videoIds)

  const { contentItems } = collections()
  const now = new Date()

  for (const video of videos) {
    let durationSec: number
    try {
      durationSec = parseIsoDuration(video.contentDetails.duration)
    } catch (error) {
      // Same per-item skip pattern as schema-validation failures above —
      // one video with an unparseable duration must not abort the whole
      // sync run.
      Sentry.captureException(error)
      continue
    }

    const thumbnailUrl = bestThumbnailUrl(video.snippet.thumbnails)
    await contentItems.updateOne(
      { platform: 'youtube', externalId: video.id },
      {
        $set: {
          title: video.snippet.title,
          url: `https://www.youtube.com/watch?v=${video.id}`,
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
          durationSec,
          raw: video,
          lastSyncAt: now,
        },
        $setOnInsert: {
          creatorId: account.creatorId,
          // Shorts are indistinguishable from regular uploads in this
          // payload shape — no explicit type signal or duration threshold
          // is available from playlistItems/videos.list. All uploads are
          // classified 'video' for W1.
          type: 'video' as ContentItemDoc['type'],
          publishedAt: new Date(video.snippet.publishedAt),
          firstSeenAt: now,
        },
      },
      { upsert: true },
    )
  }
}

async function syncMetrics(account: PlatformAccountDoc, items: ContentItemDoc[]): Promise<void> {
  const ids = items.map((item) => item.externalId)
  const videos = await fetchAllVideos(account, ids)
  const videoById = new Map(videos.map((video) => [video.id, video]))

  const { metricSnapshots } = collections()
  const capturedAt = new Date()

  for (const item of items) {
    const video = videoById.get(item.externalId)
    if (!video) {
      // Missing from the response — already reported to Sentry by
      // fetchVideosBatch if it was malformed; genuinely absent items are
      // skipped silently (e.g. deleted upstream since the last sync).
      continue
    }

    const metrics: MetricSnapshotDoc['metrics'] = { views: video.statistics.viewCount }
    if (video.statistics.likeCount !== undefined) {
      metrics.likes = video.statistics.likeCount
    }
    if (video.statistics.commentCount !== undefined) {
      metrics.comments = video.statistics.commentCount
    }

    await metricSnapshots.insertOne({
      capturedAt,
      meta: {
        creatorId: account.creatorId,
        platform: 'youtube',
        scope: 'item',
        itemExternalId: item.externalId,
      },
      metrics,
    })
  }
}

export const youtubeConnector: PlatformConnector = {
  syncChannel,
  syncContent,
  syncMetrics,
}
