// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, type CreatorDoc } from '@/db'
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

  it('resolves both concurrent calls for the same user without a duplicate-key throw', async () => {
    const userId = randomUUID()

    const [first, second] = await Promise.all([
      provisionCreator(userId, 'ConcurrentA'),
      provisionCreator(userId, 'ConcurrentB'),
    ])

    expect(first.id).toBe(second.id)
    await expect(collections().creators.countDocuments({ userId })).resolves.toBe(1)
  })

  // The memory-server test environment serializes ops over a single
  // connection tightly enough that a real concurrent findOne+insertOne race
  // does not reproduce deterministically (verified: the behavioral test
  // above passes even against the old check-then-insert implementation).
  // This test asserts the atomicity fix directly: provisionCreator must use
  // a single findOneAndUpdate upsert, never a separate findOne+insertOne.
  it('provisions via a single atomic findOneAndUpdate upsert, not check-then-insert', async () => {
    const userId = randomUUID()
    const { creators } = collections()
    const findOneAndUpdateSpy = vi.spyOn(Object.getPrototypeOf(creators), 'findOneAndUpdate')
    const insertOneSpy = vi.spyOn(Object.getPrototypeOf(creators), 'insertOne')

    await provisionCreator(userId, 'Atomic')

    expect(findOneAndUpdateSpy).toHaveBeenCalledWith(
      { userId },
      expect.objectContaining({ $setOnInsert: expect.any(Object) }),
      expect.objectContaining({ upsert: true }),
    )
    expect(insertOneSpy).not.toHaveBeenCalled()

    findOneAndUpdateSpy.mockRestore()
    insertOneSpy.mockRestore()
  })

  it('leaves platforms untouched for an existing creator on re-provision', async () => {
    const userId = randomUUID()
    const { creators } = collections()
    const seeded: CreatorDoc = {
      _id: new ObjectId(),
      userId,
      displayName: 'Seeded',
      timezone: 'UTC',
      platforms: ['twitch', 'youtube'],
      createdAt: new Date(),
    }
    await creators.insertOne(seeded)

    const creator = await provisionCreator(userId, 'Reprovisioned')

    expect(creator.platforms).toEqual(['twitch', 'youtube'])
    const doc = await creators.findOne({ userId })
    expect(doc?.platforms).toEqual(['twitch', 'youtube'])
  })

  it('throws if findOneAndUpdate unexpectedly returns no document', async () => {
    const userId = randomUUID()
    const { creators } = collections()
    const spy = vi
      .spyOn(Object.getPrototypeOf(creators), 'findOneAndUpdate')
      .mockResolvedValueOnce(null)

    await expect(provisionCreator(userId, 'ShouldThrow')).rejects.toThrow(
      /findOneAndUpdate returned no document/,
    )

    spy.mockRestore()
  })
})
