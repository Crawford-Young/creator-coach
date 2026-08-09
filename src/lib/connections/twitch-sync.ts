import type { Account } from 'next-auth'
import { collections, type PlatformAccountDoc } from '@/db'
import { encryptToken } from '@/lib/token-crypto'
import { logger } from '@/lib/logger'

const TWITCH_PLATFORM = 'twitch'
const SECONDS_TO_MS = 1000

/**
 * Copies the signIn event's fresh Twitch account tokens into
 * platformAccounts (encrypted), so connectors have credentials to work
 * with. Runs on every sign-in via authConfig.events.signIn.
 *
 * `account` MUST come from the signIn event itself — never re-read from the
 * adapter's `accounts` row. Auth.js only writes that row at FIRST link
 * (linkAccount); repeat sign-ins never update it, so reading it back
 * silently copies stale tokens/scopes forever (W1 issue #6, live-QA proven:
 * a fresh 5-scope re-auth left the row's stale W0-era 4-scope set and an
 * already-expired token in place).
 */
export async function syncTwitchAccount(
  userId: string,
  userName: string,
  account: Account | null | undefined,
): Promise<void> {
  const { creators, platformAccounts } = collections()

  // The event fires without an account on some non-OAuth flows — same
  // falsy-tolerant guard as the rest of this function (a field read back as
  // BSON null, or genuinely absent, must both be treated as "no token").
  if (!account || !account.access_token) {
    logger.warn({ userId, provider: TWITCH_PLATFORM }, 'syncTwitchAccount: no linked access token')
    return
  }

  // provisionCreator runs before syncTwitchAccount in the signIn event, so a
  // missing creator here is defensive, not an expected path.
  const creator = await creators.findOneAndUpdate(
    { userId },
    { $addToSet: { platforms: TWITCH_PLATFORM } },
    { returnDocument: 'after' },
  )
  if (creator === null) {
    logger.warn(
      { userId, provider: TWITCH_PLATFORM },
      'syncTwitchAccount: no creator found for userId',
    )
    return
  }

  const creatorId = creator._id.toHexString()

  // Falsy checks (not `!== undefined`): a field read back as BSON null (or
  // genuinely absent on the event account) must both skip the overwrite —
  // encryptToken(null) would throw inside cipher.update.
  const tokenFields: Partial<Pick<PlatformAccountDoc, 'refreshToken' | 'tokenExpiresAt'>> = {}
  if (account.refresh_token) {
    tokenFields.refreshToken = encryptToken(account.refresh_token)
  }
  if (account.expires_at) {
    tokenFields.tokenExpiresAt = new Date(account.expires_at * SECONDS_TO_MS)
  }

  await platformAccounts.updateOne(
    { creatorId, platform: TWITCH_PLATFORM },
    {
      $set: {
        accessToken: encryptToken(account.access_token),
        ...tokenFields,
        scopes: account.scope?.split(' ') ?? [],
        status: 'active',
        lastSyncAt: new Date(),
      },
      $setOnInsert: {
        externalId: account.providerAccountId,
        handle: userName,
        linkedAt: new Date(),
      },
    },
    { upsert: true },
  )
}
