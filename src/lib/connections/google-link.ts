import { randomBytes } from 'crypto'
import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { collections, type PlatformAccountDoc } from '@/db'
import { encryptToken } from '@/lib/token-crypto'
import { logger } from '@/lib/logger'
import { env } from '@/env'

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_CHANNELS_URL =
  'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true'
export const GOOGLE_LINK_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
]

export const GOOGLE_STATE_COOKIE = 'google_link_state'
export const GOOGLE_STATE_COOKIE_MAX_AGE_SECONDS = 600 // ~10 minutes, enough to complete the consent redirect round trip

const YOUTUBE_PLATFORM = 'youtube'
const SECONDS_TO_MS = 1000
const STATE_BYTES = 32

function googleCallbackRedirectUri(): string {
  return `${env.NEXT_PUBLIC_APP_URL}/api/connections/google/callback`
}

export class StateMismatchError extends Error {
  constructor(message = 'OAuth state mismatch') {
    super(message)
    this.name = 'StateMismatchError'
  }
}

export class TokenExchangeError extends Error {
  constructor(message = 'Google token exchange failed') {
    super(message)
    this.name = 'TokenExchangeError'
  }
}

export class ScopeDeniedError extends Error {
  constructor(message = 'Required Google scopes were not granted') {
    super(message)
    this.name = 'ScopeDeniedError'
  }
}

export class ChannelLookupError extends Error {
  constructor(message = 'No YouTube channel found for the linked Google account') {
    super(message)
    this.name = 'ChannelLookupError'
  }
}

export function generateState(): string {
  return randomBytes(STATE_BYTES).toString('hex')
}

export function buildGoogleAuthUrl(state: string): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', env.AUTH_GOOGLE_ID)
  url.searchParams.set('redirect_uri', googleCallbackRedirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_LINK_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)
  return url.toString()
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string(),
  token_type: z.string(),
})

const channelsResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({
        title: z.string(),
      }),
    }),
  ),
})

export interface HandleGoogleCallbackParams {
  code: string
  state: string
  stateCookie: string
  creatorId: string
}

/**
 * Exchanges the Google consent code for tokens, verifies the granted scopes
 * cover GOOGLE_LINK_SCOPES, resolves the linked channel identity, and stores
 * the encrypted tokens in platformAccounts under platform 'youtube'. All
 * logic for the google link flow lives here — the route handlers stay thin.
 */
export async function handleGoogleCallback(params: HandleGoogleCallbackParams): Promise<void> {
  const { code, state, stateCookie, creatorId } = params

  if (!state || !stateCookie || state !== stateCookie) {
    throw new StateMismatchError()
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.AUTH_GOOGLE_ID,
      client_secret: env.AUTH_GOOGLE_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: googleCallbackRedirectUri(),
    }),
  })
  if (!tokenResponse.ok) {
    logger.warn(
      { creatorId, status: tokenResponse.status },
      'handleGoogleCallback: token exchange failed',
    )
    throw new TokenExchangeError()
  }
  const token = tokenResponseSchema.parse(await tokenResponse.json())

  const grantedScopes = token.scope.split(' ')
  const hasAllRequiredScopes = GOOGLE_LINK_SCOPES.every((scope) => grantedScopes.includes(scope))
  if (!hasAllRequiredScopes) {
    logger.warn({ creatorId }, 'handleGoogleCallback: required scopes not granted')
    throw new ScopeDeniedError()
  }

  const channelsResponse = await fetch(GOOGLE_CHANNELS_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
  if (!channelsResponse.ok) {
    logger.warn(
      { creatorId, status: channelsResponse.status },
      'handleGoogleCallback: channel lookup failed',
    )
    throw new ChannelLookupError()
  }
  const channels = channelsResponseSchema.parse(await channelsResponse.json())
  const channel = channels.items[0]
  if (!channel) {
    logger.warn({ creatorId }, 'handleGoogleCallback: no channel for linked account')
    throw new ChannelLookupError()
  }

  // Falsy checks (not `!== undefined`): a stored-then-reread BSON field can
  // read back as null, and encryptToken(null) throws — same rationale as
  // twitch-sync.ts's guards.
  const tokenFields: Partial<Pick<PlatformAccountDoc, 'refreshToken' | 'tokenExpiresAt'>> = {}
  if (token.refresh_token) {
    tokenFields.refreshToken = encryptToken(token.refresh_token)
  }
  if (token.expires_in) {
    tokenFields.tokenExpiresAt = new Date(Date.now() + token.expires_in * SECONDS_TO_MS)
  }

  const { creators, platformAccounts } = collections()
  await platformAccounts.updateOne(
    { creatorId, platform: YOUTUBE_PLATFORM },
    {
      $set: {
        accessToken: encryptToken(token.access_token),
        ...tokenFields,
        scopes: grantedScopes,
        status: 'active',
        lastSyncAt: new Date(),
      },
      $setOnInsert: {
        externalId: channel.id,
        handle: channel.snippet.title,
        linkedAt: new Date(),
      },
    },
    { upsert: true },
  )

  await creators.updateOne(
    { _id: new ObjectId(creatorId) },
    { $addToSet: { platforms: YOUTUBE_PLATFORM } },
  )
}
