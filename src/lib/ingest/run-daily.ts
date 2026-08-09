import { createHash, timingSafeEqual } from 'crypto'
import * as Sentry from '@sentry/nextjs'
import { collections, type Platform, type PlatformAccountDoc } from '@/db'
import { twitchConnector } from '@/lib/connectors/twitch'
import { youtubeConnector } from '@/lib/connectors/youtube'
import { ReauthRequiredError } from '@/lib/connectors/token-refresh'
import type { PlatformConnector } from '@/lib/connectors/types'
import { logger } from '@/lib/logger'
import { env } from '@/env'

export const RECENT_ITEMS_SYNC_LIMIT = 50

const ACTIVE_STATUS = 'active'
const BEARER_PREFIX = 'Bearer '
const AUTHORIZATION_HEADER = 'authorization'

export interface AccountIngestResult {
  platform: Platform
  ok: boolean
  error?: string
}

export type IngestSummary = AccountIngestResult[]

// Future platforms (tiktok/instagram) have no connector yet — an account on
// one of them is skipped silently below, not treated as an error.
const CONNECTORS: Partial<Record<Platform, PlatformConnector>> = {
  twitch: twitchConnector,
  youtube: youtubeConnector,
}

/**
 * Constant-time Bearer auth check for the cron routes. Both the presented
 * value and the expected secret are sha256-digested first — this normalizes
 * their length before `timingSafeEqual`, which otherwise throws on a length
 * mismatch and would leak the secret's length through that exception.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const header = request.headers.get(AUTHORIZATION_HEADER)
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    return false
  }
  const presented = header.slice(BEARER_PREFIX.length)
  const presentedDigest = createHash('sha256').update(presented).digest()
  const expectedDigest = createHash('sha256').update(env.CRON_SECRET).digest()
  return timingSafeEqual(presentedDigest, expectedDigest)
}

/**
 * Runs `action` for every account, isolating failures per account so one
 * broken account never blocks its siblings. `ReauthRequiredError` is never
 * re-reported — token-refresh already flipped the account's status and
 * captured it to Sentry at refresh time; re-capturing here would just be
 * duplicate noise for an already-known condition.
 */
export async function runIsolated(
  accounts: PlatformAccountDoc[],
  action: (account: PlatformAccountDoc) => Promise<void>,
  errorContext: string,
): Promise<IngestSummary> {
  const summary: IngestSummary = []

  for (const account of accounts) {
    try {
      await action(account)
      summary.push({ platform: account.platform, ok: true })
    } catch (error) {
      if (error instanceof ReauthRequiredError) {
        summary.push({ platform: account.platform, ok: false, error: 'reauth_required' })
        continue
      }
      Sentry.captureException(error)
      logger.error({ creatorId: account.creatorId, platform: account.platform }, errorContext)
      summary.push({
        platform: account.platform,
        ok: false,
        error: error instanceof Error ? error.message : 'unknown error',
      })
    }
  }

  return summary
}

async function ingestAccount(
  account: PlatformAccountDoc,
  connector: PlatformConnector,
): Promise<void> {
  await connector.syncChannel(account)
  await connector.syncContent(account)

  const { contentItems } = collections()
  const items = await contentItems
    .find({ creatorId: account.creatorId, platform: account.platform })
    .sort({ publishedAt: -1 })
    .limit(RECENT_ITEMS_SYNC_LIMIT)
    .toArray()

  await connector.syncMetrics(account, items)
}

export async function runDailyIngest(): Promise<IngestSummary> {
  const { platformAccounts } = collections()
  const accounts = await platformAccounts.find({ status: ACTIVE_STATUS }).toArray()

  const routable = accounts.filter((account) => CONNECTORS[account.platform] !== undefined)

  return runIsolated(
    routable,
    async (account) => {
      // CONNECTORS[account.platform] is guaranteed defined — `routable` was
      // filtered above.
      const connector = CONNECTORS[account.platform]!
      await ingestAccount(account, connector)
    },
    'runDailyIngest: account sync failed',
  )
}
