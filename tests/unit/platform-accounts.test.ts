// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, type PlatformAccountDoc } from '@/db'
import { listPlatformAccounts } from '@/lib/platform-accounts'

function accountDoc(overrides: Partial<PlatformAccountDoc> = {}): PlatformAccountDoc {
  return {
    _id: new ObjectId(),
    creatorId: new ObjectId().toHexString(),
    platform: 'twitch',
    externalId: new ObjectId().toHexString(),
    handle: 'somestreamer',
    accessToken: 'v1:encrypted-access-token',
    refreshToken: 'v1:encrypted-refresh-token',
    scopes: ['channel:read:subscriptions'],
    status: 'active',
    linkedAt: new Date(),
    ...overrides,
  }
}

describe('listPlatformAccounts', () => {
  it('returns the creator’s accounts as summaries carrying the hex id', async () => {
    const creatorId = new ObjectId().toHexString()
    const doc = accountDoc({ creatorId, handle: 'nightowl', status: 'reauth_required' })
    await collections().platformAccounts.insertOne(doc)

    const accounts = await listPlatformAccounts(creatorId)

    expect(accounts).toEqual([
      {
        id: doc._id.toHexString(),
        platform: 'twitch',
        handle: 'nightowl',
        status: 'reauth_required',
      },
    ])
  })

  // The returned objects cross into client components. A key set assertion —
  // rather than a spot check on accessToken — is what stops a later field
  // addition from shipping a platform token to the browser by accident.
  it('exposes only id/platform/handle/status, never tokens or scopes', async () => {
    const creatorId = new ObjectId().toHexString()
    await collections().platformAccounts.insertOne(accountDoc({ creatorId }))

    const accounts = await listPlatformAccounts(creatorId)

    expect(Object.keys(accounts[0]).sort()).toEqual(['handle', 'id', 'platform', 'status'])
  })

  it('is tenant-scoped — another creator’s accounts never appear', async () => {
    const creatorId = new ObjectId().toHexString()
    const otherCreatorId = new ObjectId().toHexString()
    await collections().platformAccounts.insertMany([
      accountDoc({ creatorId, platform: 'twitch' }),
      accountDoc({ creatorId: otherCreatorId, platform: 'youtube' }),
    ])

    const accounts = await listPlatformAccounts(creatorId)

    expect(accounts.map((account) => account.platform)).toEqual(['twitch'])
  })

  it('orders accounts by platform so the dashboard renders deterministically', async () => {
    const creatorId = new ObjectId().toHexString()
    await collections().platformAccounts.insertMany([
      accountDoc({ creatorId, platform: 'youtube' }),
      accountDoc({ creatorId, platform: 'twitch' }),
    ])

    const accounts = await listPlatformAccounts(creatorId)

    expect(accounts.map((account) => account.platform)).toEqual(['twitch', 'youtube'])
  })

  it('returns an empty list for a creator with nothing linked', async () => {
    expect(await listPlatformAccounts(new ObjectId().toHexString())).toEqual([])
  })
})
