import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'
import { collections, type ContentItemDoc, type ContentType, type PlatformAccountDoc } from '@/db'
import { getFreshTwitchToken } from '@/lib/connectors/token-refresh'
import { logger } from '@/lib/logger'
import { env } from '@/env'
import type { PlatformConnector } from '@/lib/connectors/types'

const TWITCH_PLATFORM = 'twitch'
const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate'
const TWITCH_HELIX_BASE = 'https://api.twitch.tv/helix'
const HELIX_PAGE_SIZE = 100
const RATE_LIMIT_RESET_HEADER = 'Ratelimit-Reset'
const HTTP_TOO_MANY_REQUESTS = 429
const SECONDS_TO_MS = 1000
// Overlap window subtracted from account.lastSyncAt when paging clips, so a
// clip created right at the edge of the last sync is never missed —
// idempotent because contentItems upserts on (platform, externalId).
const CLIP_OVERLAP_MS = 24 * 60 * 60 * SECONDS_TO_MS

export class TwitchValidationError extends Error {
  constructor(creatorId: string) {
    super(`Twitch token validation failed for creator ${creatorId}`)
    this.name = 'TwitchValidationError'
  }
}

export class TwitchRateLimitError extends Error {
  constructor() {
    super('Twitch API rate limit exceeded after one retry')
    this.name = 'TwitchRateLimitError'
  }
}

export class TwitchApiError extends Error {
  constructor(status: number) {
    super(`Twitch API request failed with status ${status}`)
    this.name = 'TwitchApiError'
  }
}

// Test-only hook: the rate-limit backoff sleep is injectable so tests never
// perform a real wall-clock wait.
let sleepImpl: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms))

export function __setSleepForTesting(fn: (ms: number) => Promise<void>): void {
  sleepImpl = fn
}

const followersResponseSchema = z.object({
  total: z.number(),
})

const subscriptionsResponseSchema = z.object({
  total: z.number(),
  points: z.number(),
})

const streamItemSchema = z.object({
  type: z.string(),
  viewer_count: z.number(),
})

const streamsResponseSchema = z.object({
  data: z.array(streamItemSchema),
})

const videoItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  thumbnail_url: z.string(),
  view_count: z.number(),
  published_at: z.string(),
})

const clipItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  thumbnail_url: z.string(),
  view_count: z.number(),
  created_at: z.string(),
})

const listEnvelopeSchema = z.object({
  data: z.array(z.unknown()),
  pagination: z.object({ cursor: z.string().optional() }).optional(),
})

function buildHelixUrl(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params)
  return `${TWITCH_HELIX_BASE}${path}?${search.toString()}`
}

function buildHelixUrlMulti(path: string, key: string, values: string[]): string {
  const search = new URLSearchParams()
  for (const value of values) search.append(key, value)
  return `${TWITCH_HELIX_BASE}${path}?${search.toString()}`
}

/**
 * Splits an array into HELIX_PAGE_SIZE-sized groups — Twitch caps repeated
 * `id=` params at 100 per call on the Videos/Clips id-batch endpoints (the
 * same cap used for pagination's `first`), so a batch over that size must
 * be split into multiple requests, never sent as one oversized call.
 */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function rateLimitWaitMs(response: Response): number {
  const resetHeader = response.headers.get(RATE_LIMIT_RESET_HEADER)
  const resetEpochSec = resetHeader ? Number(resetHeader) : 0
  return Math.max(0, resetEpochSec * SECONDS_TO_MS - Date.now())
}

async function fetchHelixJson(url: string, accessToken: string): Promise<unknown> {
  const doFetch = (): Promise<Response> =>
    fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': env.AUTH_TWITCH_ID,
      },
    })

  let response = await doFetch()
  if (response.status === HTTP_TOO_MANY_REQUESTS) {
    await sleepImpl(rateLimitWaitMs(response))
    response = await doFetch()
    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      throw new TwitchRateLimitError()
    }
  }
  if (!response.ok) {
    throw new TwitchApiError(response.status)
  }
  return response.json()
}

async function isTokenValid(accessToken: string): Promise<boolean> {
  const response = await fetch(TWITCH_VALIDATE_URL, {
    headers: { Authorization: `OAuth ${accessToken}` },
  })
  return response.ok
}

/**
 * Every connector entry point calls this first: decrypt-check-refresh
 * (T6's getFreshTwitchToken), then validate — Twitch requires validation at
 * the start of every run. A 401 forces one refresh + retry; a second 401 is
 * a hard failure, not a silent skip.
 */
async function ensureValidToken(account: PlatformAccountDoc): Promise<string> {
  let fresh = await getFreshTwitchToken(account)
  let ok = await isTokenValid(fresh.accessToken)
  if (!ok) {
    fresh = await getFreshTwitchToken(account, { forceRefresh: true })
    ok = await isTokenValid(fresh.accessToken)
  }
  if (!ok) {
    throw new TwitchValidationError(account.creatorId)
  }
  return fresh.accessToken
}

interface ParsedListItem<T> {
  raw: unknown
  data: T
}

/**
 * Validates each item in a Twitch list response independently. A malformed
 * item is reported to Sentry and skipped — it never aborts the whole run.
 */
function parseListItems<T>(
  rawItems: unknown[],
  schema: z.ZodType<T>,
  creatorId: string,
  itemKind: string,
): ParsedListItem<T>[] {
  const items: ParsedListItem<T>[] = []
  for (const raw of rawItems) {
    const parsed = schema.safeParse(raw)
    if (parsed.success) {
      items.push({ raw, data: parsed.data })
    } else {
      logger.warn({ creatorId, itemKind }, 'twitch: skipping malformed list item')
      Sentry.captureException(new Error(`Twitch ${itemKind} item failed schema validation`))
    }
  }
  return items
}

interface ContentItemInput {
  externalId: string
  type: ContentType
  title: string
  url: string
  thumbnailUrl: string
  publishedAt: Date
  raw: unknown
}

async function upsertContentItem(
  account: PlatformAccountDoc,
  input: ContentItemInput,
  now: Date,
): Promise<void> {
  const { contentItems } = collections()
  await contentItems.updateOne(
    { platform: TWITCH_PLATFORM, externalId: input.externalId },
    {
      $set: {
        title: input.title,
        url: input.url,
        thumbnailUrl: input.thumbnailUrl,
        raw: input.raw,
        lastSyncAt: now,
      },
      $setOnInsert: {
        creatorId: account.creatorId,
        platform: TWITCH_PLATFORM,
        type: input.type,
        publishedAt: input.publishedAt,
        firstSeenAt: now,
      },
    },
    { upsert: true },
  )
}

async function fetchAllVideos(
  account: PlatformAccountDoc,
  accessToken: string,
): Promise<ParsedListItem<z.infer<typeof videoItemSchema>>[]> {
  const items: ParsedListItem<z.infer<typeof videoItemSchema>>[] = []
  let cursor: string | undefined
  do {
    const params: Record<string, string> = {
      user_id: account.externalId,
      type: 'archive',
      first: String(HELIX_PAGE_SIZE),
    }
    if (cursor) params.after = cursor
    const url = buildHelixUrl('/videos', params)
    const json = await fetchHelixJson(url, accessToken)
    const envelope = listEnvelopeSchema.parse(json)
    items.push(...parseListItems(envelope.data, videoItemSchema, account.creatorId, 'video'))
    cursor = envelope.pagination?.cursor
  } while (cursor)
  return items
}

async function fetchAllClips(
  account: PlatformAccountDoc,
  accessToken: string,
): Promise<ParsedListItem<z.infer<typeof clipItemSchema>>[]> {
  const items: ParsedListItem<z.infer<typeof clipItemSchema>>[] = []
  let cursor: string | undefined
  const params: Record<string, string> = {
    broadcaster_id: account.externalId,
    first: String(HELIX_PAGE_SIZE),
  }
  if (account.lastSyncAt) {
    params.started_at = new Date(account.lastSyncAt.getTime() - CLIP_OVERLAP_MS).toISOString()
  }
  do {
    if (cursor) params.after = cursor
    const url = buildHelixUrl('/clips', params)
    const json = await fetchHelixJson(url, accessToken)
    const envelope = listEnvelopeSchema.parse(json)
    items.push(...parseListItems(envelope.data, clipItemSchema, account.creatorId, 'clip'))
    cursor = envelope.pagination?.cursor
  } while (cursor)
  return items
}

async function syncChannel(account: PlatformAccountDoc): Promise<void> {
  const accessToken = await ensureValidToken(account)

  const followersUrl = buildHelixUrl('/channels/followers', {
    broadcaster_id: account.externalId,
    first: '1',
  })
  const followers = followersResponseSchema.parse(await fetchHelixJson(followersUrl, accessToken))

  const subsUrl = buildHelixUrl('/subscriptions', {
    broadcaster_id: account.externalId,
    first: '1',
  })
  const subs = subscriptionsResponseSchema.parse(await fetchHelixJson(subsUrl, accessToken))

  const { metricSnapshots } = collections()
  await metricSnapshots.insertOne({
    capturedAt: new Date(),
    meta: { creatorId: account.creatorId, platform: TWITCH_PLATFORM, scope: 'channel' },
    metrics: {
      followers: followers.total,
      subscribers: subs.total,
      subPoints: subs.points,
    },
  })
}

async function syncContent(account: PlatformAccountDoc): Promise<void> {
  const accessToken = await ensureValidToken(account)
  const now = new Date()

  const videos = await fetchAllVideos(account, accessToken)
  for (const video of videos) {
    await upsertContentItem(
      account,
      {
        externalId: video.data.id,
        type: 'vod',
        title: video.data.title,
        url: video.data.url,
        thumbnailUrl: video.data.thumbnail_url,
        publishedAt: new Date(video.data.published_at),
        raw: video.raw,
      },
      now,
    )
  }

  const clips = await fetchAllClips(account, accessToken)
  for (const clip of clips) {
    await upsertContentItem(
      account,
      {
        externalId: clip.data.id,
        type: 'clip',
        title: clip.data.title,
        url: clip.data.url,
        thumbnailUrl: clip.data.thumbnail_url,
        publishedAt: new Date(clip.data.created_at),
        raw: clip.raw,
      },
      now,
    )
  }
}

/**
 * Fetches current view_count for a batch of externalIds against a Twitch
 * id-batch endpoint (Videos or Clips), chunked to HELIX_PAGE_SIZE ids per
 * request, and merges results into the shared viewCounts map.
 */
async function fetchViewCounts<T extends { id: string; view_count: number }>(
  account: PlatformAccountDoc,
  accessToken: string,
  path: string,
  schema: z.ZodType<T>,
  itemKind: string,
  externalIds: string[],
  viewCounts: Map<string, number>,
): Promise<void> {
  for (const idsChunk of chunk(externalIds, HELIX_PAGE_SIZE)) {
    const url = buildHelixUrlMulti(path, 'id', idsChunk)
    const envelope = listEnvelopeSchema.parse(await fetchHelixJson(url, accessToken))
    for (const parsed of parseListItems(envelope.data, schema, account.creatorId, itemKind)) {
      viewCounts.set(parsed.data.id, parsed.data.view_count)
    }
  }
}

async function syncMetrics(account: PlatformAccountDoc, items: ContentItemDoc[]): Promise<void> {
  const accessToken = await ensureValidToken(account)
  const vodItems = items.filter((item) => item.type === 'vod')
  const clipItems = items.filter((item) => item.type === 'clip')

  const viewCounts = new Map<string, number>()

  if (vodItems.length > 0) {
    await fetchViewCounts(
      account,
      accessToken,
      '/videos',
      videoItemSchema,
      'video',
      vodItems.map((item) => item.externalId),
      viewCounts,
    )
  }

  if (clipItems.length > 0) {
    await fetchViewCounts(
      account,
      accessToken,
      '/clips',
      clipItemSchema,
      'clip',
      clipItems.map((item) => item.externalId),
      viewCounts,
    )
  }

  const { metricSnapshots } = collections()
  const now = new Date()
  for (const item of [...vodItems, ...clipItems]) {
    const viewCount = viewCounts.get(item.externalId)
    if (viewCount === undefined) continue
    await metricSnapshots.insertOne({
      capturedAt: now,
      meta: {
        creatorId: account.creatorId,
        platform: TWITCH_PLATFORM,
        scope: 'item',
        itemExternalId: item.externalId,
      },
      metrics: { views: viewCount },
    })
  }
}

export const twitchConnector: PlatformConnector = {
  syncChannel,
  syncContent,
  syncMetrics,
}

export async function checkLive(account: PlatformAccountDoc): Promise<void> {
  const accessToken = await ensureValidToken(account)
  const url = buildHelixUrl('/streams', { user_id: account.externalId })
  const streams = streamsResponseSchema.parse(await fetchHelixJson(url, accessToken))
  const stream = streams.data[0]
  if (!stream || stream.type !== 'live') {
    return
  }

  const { metricSnapshots } = collections()
  await metricSnapshots.insertOne({
    capturedAt: new Date(),
    meta: { creatorId: account.creatorId, platform: TWITCH_PLATFORM, scope: 'channel' },
    metrics: { ccv: stream.viewer_count },
  })
}
