import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'
import { collections, type Platform, type PlatformAccountDoc } from '@/db'
import { decryptToken, encryptToken } from '@/lib/token-crypto'
import { logger } from '@/lib/logger'
import { env } from '@/env'
import type { FreshToken, RefreshOptions } from './types'

export const TOKEN_EXPIRY_MARGIN_SEC = 300

const SECONDS_TO_MS = 1000
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

export class ReauthRequiredError extends Error {
  readonly creatorId: string
  readonly platform: Platform

  constructor(creatorId: string, platform: Platform) {
    super(`Reauth required for creator ${creatorId} platform ${platform}`)
    this.name = 'ReauthRequiredError'
    this.creatorId = creatorId
    this.platform = platform
  }
}

interface RefreshProviderConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
}

const refreshResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
})

function needsRefresh(account: PlatformAccountDoc, options?: RefreshOptions): boolean {
  if (options?.forceRefresh) return true
  if (!account.tokenExpiresAt) return true
  const marginMs = TOKEN_EXPIRY_MARGIN_SEC * SECONDS_TO_MS
  return account.tokenExpiresAt.getTime() <= Date.now() + marginMs
}

async function markReauthRequired(account: PlatformAccountDoc): Promise<never> {
  const { platformAccounts } = collections()
  await platformAccounts.updateOne({ _id: account._id }, { $set: { status: 'reauth_required' } })
  logger.warn(
    { creatorId: account.creatorId, platform: account.platform },
    'token refresh: reauth required',
  )
  const error = new ReauthRequiredError(account.creatorId, account.platform)
  Sentry.captureException(error)
  throw error
}

async function refresh(
  account: PlatformAccountDoc,
  config: RefreshProviderConfig,
): Promise<FreshToken> {
  if (!account.refreshToken) {
    return markReauthRequired(account)
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: decryptToken(account.refreshToken),
    }),
  })
  if (!response.ok) {
    return markReauthRequired(account)
  }

  const parsed = refreshResponseSchema.safeParse(await response.json())
  if (!parsed.success) {
    return markReauthRequired(account)
  }
  const token = parsed.data

  // Falsy-tolerant guard, same pattern as twitch-sync.ts/google-link.ts:
  // Twitch always returns a rotated refresh_token (must be persisted every
  // success or subsequent refreshes fail); Google normally omits it on
  // refresh, in which case the stored value must survive untouched.
  const tokenFields: Partial<Pick<PlatformAccountDoc, 'refreshToken'>> = {}
  if (token.refresh_token) {
    tokenFields.refreshToken = encryptToken(token.refresh_token)
  }

  const { platformAccounts } = collections()
  await platformAccounts.updateOne(
    { _id: account._id },
    {
      $set: {
        accessToken: encryptToken(token.access_token),
        ...tokenFields,
        tokenExpiresAt: new Date(Date.now() + token.expires_in * SECONDS_TO_MS),
        status: 'active',
      },
    },
  )

  return { accessToken: token.access_token }
}

/**
 * Decrypt-check-refresh-persist for a Twitch platformAccounts doc. Every
 * connector entry point calls this (or getFreshGoogleToken) before making an
 * authenticated Twitch API call.
 */
export async function getFreshTwitchToken(
  account: PlatformAccountDoc,
  options?: RefreshOptions,
): Promise<FreshToken> {
  const plaintext = decryptToken(account.accessToken)
  if (!needsRefresh(account, options)) {
    return { accessToken: plaintext }
  }
  return refresh(account, {
    tokenUrl: TWITCH_TOKEN_URL,
    clientId: env.AUTH_TWITCH_ID,
    clientSecret: env.AUTH_TWITCH_SECRET,
  })
}

/**
 * Decrypt-check-refresh-persist for a Google (YouTube) platformAccounts doc.
 *
 * A2: Google's refresh-grant body is assumed to follow the RFC 6749 §6
 * shape (Google's own docs page was truncated at doc-recon time) — verify
 * at the first live refresh and correct this connector if Google errors.
 */
export async function getFreshGoogleToken(
  account: PlatformAccountDoc,
  options?: RefreshOptions,
): Promise<FreshToken> {
  const plaintext = decryptToken(account.accessToken)
  if (!needsRefresh(account, options)) {
    return { accessToken: plaintext }
  }
  return refresh(account, {
    tokenUrl: GOOGLE_TOKEN_URL,
    clientId: env.AUTH_GOOGLE_ID,
    clientSecret: env.AUTH_GOOGLE_SECRET,
  })
}
