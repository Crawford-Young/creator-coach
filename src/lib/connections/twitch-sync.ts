import { ObjectId } from 'mongodb'
import { collections, type PlatformAccountDoc } from '@/db'
import { encryptToken } from '@/lib/token-crypto'
import { logger } from '@/lib/logger'

const TWITCH_PLATFORM = 'twitch'
const SECONDS_TO_MS = 1000

/**
 * Copies the Auth.js adapter's stored Twitch tokens into platformAccounts
 * (encrypted), so connectors have credentials to work with. Runs on every
 * sign-in via authConfig.events.signIn.
 */
export async function syncTwitchAccount(userId: string, userName: string): Promise<void> {
  const { authAccounts, creators, platformAccounts } = collections()

  const account = await authAccounts.findOne({
    provider: TWITCH_PLATFORM,
    userId: new ObjectId(userId),
  })
  // The MongoDB driver stores a field explicitly set to `undefined` as BSON
  // null (ignoreUndefined defaults to false) — a falsy check catches both a
  // genuinely missing access_token and one written as null.
  if (account === null || !account.access_token) {
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

  // Falsy checks (not `!== undefined`) to match the access_token guard above:
  // a BSON-null field reads back as a falsy value typed as string, and
  // encryptToken(null) would throw inside cipher.update. Unreachable via the
  // current adapter's linkAccount (absent JSON keys never become null), but
  // the accounts collection outlives any one adapter version.
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
