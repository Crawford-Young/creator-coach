// @vitest-environment node
import { ObjectId } from 'mongodb'
import { describe, expect, it } from 'vitest'
import { collections, type AuthAccountDoc, type CreatorDoc, type PlatformAccountDoc } from '@/db'
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

function seedAuthAccount(
  userId: string,
  overrides: Partial<AuthAccountDoc> = {},
): Promise<AuthAccountDoc> {
  const doc: AuthAccountDoc = {
    _id: new ObjectId(),
    userId: new ObjectId(userId),
    provider: 'twitch',
    providerAccountId: `twitch-ext-${new ObjectId().toHexString()}`,
    type: 'oauth',
    access_token: 'plain-access-token',
    refresh_token: 'plain-refresh-token',
    expires_at: Math.floor(Date.now() / SECONDS_TO_MS) + 3600,
    scope: 'openid user:read:email',
    token_type: 'bearer',
    ...overrides,
  }
  return collections()
    .authAccounts.insertOne(doc)
    .then(() => doc)
}

describe('syncTwitchAccount', () => {
  it('links a fresh account: encrypts tokens, sets scopes/status, adds twitch to platforms once', async () => {
    const userId = new ObjectId().toHexString()
    const creator = await seedCreator(userId, ['twitch'])
    const account = await seedAuthAccount(userId)

    await syncTwitchAccount(userId, 'StreamerName')

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

  it('preserves the stored refreshToken and tokenExpiresAt when a re-login omits them', async () => {
    const userId = new ObjectId().toHexString()
    const creator = await seedCreator(userId)
    const creatorId = creator._id.toHexString()
    await seedAuthAccount(userId, {
      access_token: 'first-access-token',
      refresh_token: 'first-refresh-token',
    })

    await syncTwitchAccount(userId, 'Handle')

    const { platformAccounts, authAccounts } = collections()
    const first = await platformAccounts.findOne({ creatorId, platform: 'twitch' })
    const storedRefresh = first!.refreshToken
    const storedExpiry = first!.tokenExpiresAt

    await authAccounts.updateOne(
      { provider: 'twitch', userId: new ObjectId(userId) },
      {
        $set: { access_token: 'second-access-token' },
        $unset: { refresh_token: '', expires_at: '', scope: '' },
      },
    )
    await syncTwitchAccount(userId, 'Handle')

    const second = await platformAccounts.findOne({ creatorId, platform: 'twitch' })
    expect(second!.refreshToken).toBe(storedRefresh)
    expect(decryptToken(second!.refreshToken!)).toBe('first-refresh-token')
    expect(second!.tokenExpiresAt).toEqual(storedExpiry)
    expect(decryptToken(second!.accessToken)).toBe('second-access-token')
    expect(second!.scopes).toEqual([])
    expect(second!.lastSyncAt!.getTime()).toBeGreaterThanOrEqual(first!.lastSyncAt!.getTime())
  })

  it('flips an existing reauth_required platformAccounts doc to active on successful sync', async () => {
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
    await seedAuthAccount(userId)

    await syncTwitchAccount(userId, 'NewHandle')

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'twitch' })
    expect(doc!.status).toBe('active')
  })

  it('resolves without writing when no matching adapter account doc exists', async () => {
    const userId = new ObjectId().toHexString()
    const creator = await seedCreator(userId)
    const creatorId = creator._id.toHexString()

    await expect(syncTwitchAccount(userId, 'NoAccount')).resolves.toBeUndefined()

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'twitch' })
    expect(doc).toBeNull()
  })

  it('resolves without writing when the adapter account doc has no access_token', async () => {
    const userId = new ObjectId().toHexString()
    const creator = await seedCreator(userId)
    const creatorId = creator._id.toHexString()
    await seedAuthAccount(userId, { access_token: undefined })

    await expect(syncTwitchAccount(userId, 'NoToken')).resolves.toBeUndefined()

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'twitch' })
    expect(doc).toBeNull()
  })

  it('resolves without writing when no creator document matches the userId', async () => {
    const userId = new ObjectId().toHexString()
    await seedAuthAccount(userId)

    await expect(syncTwitchAccount(userId, 'NoCreator')).resolves.toBeUndefined()

    const doc = await collections().platformAccounts.findOne({ handle: 'NoCreator' })
    expect(doc).toBeNull()
  })
})
