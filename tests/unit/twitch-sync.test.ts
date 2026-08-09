// @vitest-environment node
import { ObjectId } from 'mongodb'
import type { Account } from 'next-auth'
import { describe, expect, it } from 'vitest'
import { collections, getDb, type CreatorDoc, type PlatformAccountDoc } from '@/db'
import { decryptToken, isEncrypted } from '@/lib/token-crypto'
import { syncTwitchAccount } from '@/lib/connections/twitch-sync'

const SECONDS_TO_MS = 1000

function seedCreator(userId: string, platforms: string[] = []): Promise<CreatorDoc> {
  const doc: CreatorDoc = {
    _id: new ObjectId(),
    userId,
    displayName: 'Streamer',
    timezone: 'UTC',
    platforms,
    createdAt: new Date(),
  }
  return collections()
    .creators.insertOne(doc)
    .then(() => doc)
}

function freshAccount(overrides: Partial<Account> = {}): Account {
  return {
    provider: 'twitch',
    providerAccountId: `twitch-ext-${new ObjectId().toHexString()}`,
    type: 'oauth',
    access_token: 'plain-access-token',
    refresh_token: 'plain-refresh-token',
    expires_at: Math.floor(Date.now() / SECONDS_TO_MS) + 3600,
    scope: 'openid user:read:email',
    token_type: 'bearer',
    ...overrides,
  } as Account
}

describe('syncTwitchAccount', () => {
  it('links a fresh account: encrypts tokens, sets scopes/status, adds twitch to platforms once', async () => {
    const userId = new ObjectId().toHexString()
    const creator = await seedCreator(userId, ['twitch'])
    const account = freshAccount()

    await syncTwitchAccount(userId, 'StreamerName', account)

    const { platformAccounts, creators } = collections()
    const creatorId = creator._id.toHexString()
    const doc = await platformAccounts.findOne({ creatorId, platform: 'twitch' })

    expect(doc).not.toBeNull()
    expect(isEncrypted(doc!.accessToken)).toBe(true)
    expect(decryptToken(doc!.accessToken)).toBe('plain-access-token')
    expect(isEncrypted(doc!.refreshToken!)).toBe(true)
    expect(decryptToken(doc!.refreshToken!)).toBe('plain-refresh-token')
    expect(doc!.scopes).toEqual(['openid', 'user:read:email'])
    expect(doc!.status).toBe('active')
    expect(doc!.externalId).toBe(account.providerAccountId)
    expect(doc!.handle).toBe('StreamerName')
    expect(doc!.linkedAt).toBeInstanceOf(Date)
    expect(doc!.tokenExpiresAt).toEqual(new Date(account.expires_at! * SECONDS_TO_MS))

    const updatedCreator = await creators.findOne({ userId })
    expect(updatedCreator?.platforms.filter((p) => p === 'twitch')).toHaveLength(1)
  })

  // THE regression test for W1 issue #6 (live-QA defect): syncTwitchAccount
  // must NEVER read the adapter's `accounts` row — Auth.js only writes that
  // row at FIRST link (linkAccount); repeat sign-ins never update it, so
  // reading it back silently copies stale tokens/scopes forever. This seeds
  // a stale decoy row directly via the adapter-owned `accounts` collection
  // (raw getDb() access is deliberate here: unlike creators/platformAccounts/
  // contentItems/metricSnapshots, `accounts` is NOT one of our modeled
  // collections — it belongs to @auth/mongodb-adapter, which is why
  // src/db/index.ts's typed authAccounts accessor was removed as dead code
  // once this fix landed) and asserts the FRESH signIn-event account always
  // wins, never the stale row.
  it('uses the signIn event account, never a stale adapter accounts row', async () => {
    const userId = new ObjectId().toHexString()
    const creator = await seedCreator(userId)
    const creatorId = creator._id.toHexString()

    await getDb()
      .collection('accounts')
      .insertOne({
        userId: new ObjectId(userId),
        provider: 'twitch',
        providerAccountId: 'stale-provider-account-id',
        type: 'oauth',
        access_token: 'STALE-access-token',
        refresh_token: 'STALE-refresh-token',
        expires_at: Math.floor(Date.now() / SECONDS_TO_MS) - 3600, // already expired
        // W0-era 4-scope set — the live-QA defect: a fresh 5-scope re-auth
        // never overwrote this row, so the stale set kept being copied.
        scope: 'openid user:read:email channel:manage:broadcast channel:read:subscriptions',
        token_type: 'bearer',
      })

    const freshExpiresAt = Math.floor(Date.now() / SECONDS_TO_MS) + 14400
    const account = freshAccount({
      providerAccountId: 'fresh-provider-account-id',
      access_token: 'FRESH-access-token',
      refresh_token: 'FRESH-refresh-token',
      expires_at: freshExpiresAt,
      scope:
        'openid user:read:email channel:manage:broadcast channel:read:subscriptions moderator:read:followers',
    })

    await syncTwitchAccount(userId, 'StreamerName', account)

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'twitch' })
    expect(decryptToken(doc!.accessToken)).toBe('FRESH-access-token')
    expect(decryptToken(doc!.refreshToken!)).toBe('FRESH-refresh-token')
    expect(doc!.scopes).toEqual([
      'openid',
      'user:read:email',
      'channel:manage:broadcast',
      'channel:read:subscriptions',
      'moderator:read:followers',
    ])
    expect(doc!.tokenExpiresAt).toEqual(new Date(freshExpiresAt * SECONDS_TO_MS))
    expect(doc!.externalId).toBe('fresh-provider-account-id')
    expect(doc!.status).toBe('active')
  })

  it('a reauth_required account flips back to active on next sign-in with a fresh account', async () => {
    const userId = new ObjectId().toHexString()
    const creator = await seedCreator(userId)
    const creatorId = creator._id.toHexString()
    const staleDoc: PlatformAccountDoc = {
      _id: new ObjectId(),
      creatorId,
      platform: 'twitch',
      externalId: 'stale-external-id',
      handle: 'OldHandle',
      accessToken: 'v1:stale-value',
      scopes: [],
      status: 'reauth_required',
      linkedAt: new Date(),
    }
    await collections().platformAccounts.insertOne(staleDoc)

    await syncTwitchAccount(userId, 'NewHandle', freshAccount())

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'twitch' })
    expect(doc!.status).toBe('active')
  })

  it('preserves the stored refreshToken and tokenExpiresAt when a re-login event omits them', async () => {
    const userId = new ObjectId().toHexString()
    const creator = await seedCreator(userId)
    const creatorId = creator._id.toHexString()

    await syncTwitchAccount(
      userId,
      'Handle',
      freshAccount({ access_token: 'first-access-token', refresh_token: 'first-refresh-token' }),
    )

    const { platformAccounts } = collections()
    const first = await platformAccounts.findOne({ creatorId, platform: 'twitch' })
    const storedRefresh = first!.refreshToken
    const storedExpiry = first!.tokenExpiresAt

    await syncTwitchAccount(
      userId,
      'Handle',
      freshAccount({
        access_token: 'second-access-token',
        refresh_token: undefined,
        expires_at: undefined,
        scope: undefined,
      }),
    )

    const second = await platformAccounts.findOne({ creatorId, platform: 'twitch' })
    expect(second!.refreshToken).toBe(storedRefresh)
    expect(decryptToken(second!.refreshToken!)).toBe('first-refresh-token')
    expect(second!.tokenExpiresAt).toEqual(storedExpiry)
    expect(decryptToken(second!.accessToken)).toBe('second-access-token')
    expect(second!.scopes).toEqual([])
    expect(second!.lastSyncAt!.getTime()).toBeGreaterThanOrEqual(first!.lastSyncAt!.getTime())
  })

  it('resolves without writing when the event account is null (non-OAuth sign-in flow)', async () => {
    const userId = new ObjectId().toHexString()
    const creator = await seedCreator(userId)
    const creatorId = creator._id.toHexString()

    await expect(syncTwitchAccount(userId, 'NoAccount', null)).resolves.toBeUndefined()

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'twitch' })
    expect(doc).toBeNull()
  })

  it('resolves without writing when the event account is undefined', async () => {
    const userId = new ObjectId().toHexString()
    const creator = await seedCreator(userId)
    const creatorId = creator._id.toHexString()

    await expect(syncTwitchAccount(userId, 'NoAccount', undefined)).resolves.toBeUndefined()

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'twitch' })
    expect(doc).toBeNull()
  })

  it('resolves without writing when the event account has no access_token', async () => {
    const userId = new ObjectId().toHexString()
    const creator = await seedCreator(userId)
    const creatorId = creator._id.toHexString()

    await expect(
      syncTwitchAccount(userId, 'NoToken', freshAccount({ access_token: undefined })),
    ).resolves.toBeUndefined()

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'twitch' })
    expect(doc).toBeNull()
  })

  it('resolves without writing when no creator document matches the userId', async () => {
    const userId = new ObjectId().toHexString()

    await expect(syncTwitchAccount(userId, 'NoCreator', freshAccount())).resolves.toBeUndefined()

    const doc = await collections().platformAccounts.findOne({ handle: 'NoCreator' })
    expect(doc).toBeNull()
  })
})
