// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ObjectId } from 'mongodb'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))

import { requireCreator, UnauthorizedError } from '@/lib/tenant'
import { auth } from '@/lib/auth'
import { collections, type CreatorDoc } from '@/db'

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('requireCreator', () => {
  it('throws UnauthorizedError when auth() returns null (unauthenticated)', async () => {
    mockAuth.mockResolvedValueOnce(null)

    const rejection = requireCreator()
    await expect(rejection).rejects.toThrow(UnauthorizedError)
    await expect(rejection).rejects.toThrow('Not authenticated')
  })

  it('throws UnauthorizedError when session exists but no creator doc found', async () => {
    const userId = randomUUID()
    mockAuth.mockResolvedValueOnce({ user: { id: userId } })

    const rejection = requireCreator()
    await expect(rejection).rejects.toThrow(UnauthorizedError)
    await expect(rejection).rejects.toThrow('No creator tenant for user')
  })

  it('returns the mapped creator when authenticated and creator doc exists', async () => {
    const userId = randomUUID()
    const createdAt = new Date()
    const doc: CreatorDoc = {
      _id: new ObjectId(),
      userId,
      displayName: 'Streamer',
      timezone: 'UTC',
      platforms: ['twitch'],
      createdAt,
    }
    await collections().creators.insertOne(doc)

    mockAuth.mockResolvedValueOnce({ user: { id: userId } })

    const result = await requireCreator()
    expect(result).toEqual({
      id: doc._id.toHexString(),
      userId,
      displayName: 'Streamer',
      timezone: 'UTC',
      platforms: ['twitch'],
      createdAt,
    })
  })
})
