// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { collections } from '@/db'
import { provisionCreator } from '@/lib/provision'

describe('provisionCreator', () => {
  it('creates a creator document for a new user and returns the mapped creator', async () => {
    const userId = randomUUID()

    const creator = await provisionCreator(userId, 'Streamer')

    expect(creator).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      userId,
      displayName: 'Streamer',
      timezone: 'UTC',
      platforms: ['twitch'],
      createdAt: expect.any(Date),
    })

    const doc = await collections().creators.findOne({ userId })
    expect(doc).not.toBeNull()
    expect(doc?._id.toHexString()).toBe(creator.id)
    expect(doc?.displayName).toBe('Streamer')
    expect(doc?.timezone).toBe('UTC')
    expect(doc?.platforms).toEqual(['twitch'])
  })

  it('is idempotent — a second call for the same user reuses the existing document', async () => {
    const userId = randomUUID()

    const first = await provisionCreator(userId, 'Original')
    const second = await provisionCreator(userId, 'Renamed')

    expect(second.id).toBe(first.id)
    expect(second.displayName).toBe('Original')
    await expect(collections().creators.countDocuments({ userId })).resolves.toBe(1)
  })

  it('falls back to the default display name when displayName is blank', async () => {
    const userId = randomUUID()

    const creator = await provisionCreator(userId, '')

    expect(creator.displayName).toBe('Creator')
    const doc = await collections().creators.findOne({ userId })
    expect(doc?.displayName).toBe('Creator')
  })
})
