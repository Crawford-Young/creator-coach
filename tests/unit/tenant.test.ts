// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/db', () => ({ db: { select: vi.fn() } }))
vi.mock('@/db/schema', () => ({ creators: { userId: 'userId_col' } }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((col, val) => ({ col, val })) }))

import { requireCreator, UnauthorizedError } from '@/lib/tenant'
import { auth } from '@/lib/auth'
import { db } from '@/db'

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>
const mockDb = db as unknown as { select: ReturnType<typeof vi.fn> }

beforeEach(() => vi.clearAllMocks())

describe('requireCreator', () => {
  it('throws UnauthorizedError when auth() returns null (unauthenticated)', async () => {
    mockAuth.mockResolvedValueOnce(null)

    const rejection = requireCreator()
    await expect(rejection).rejects.toThrow(UnauthorizedError)
    await expect(rejection).rejects.toThrow('Not authenticated')
  })

  it('throws UnauthorizedError when session exists but no creator row found', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'u1' } })

    mockDb.select.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    }))

    const rejection = requireCreator()
    await expect(rejection).rejects.toThrow(UnauthorizedError)
    await expect(rejection).rejects.toThrow('No creator tenant for user')
  })

  it('returns the creator row when authenticated and creator exists', async () => {
    const creatorRow = {
      id: 'c1',
      userId: 'u1',
      displayName: 'Streamer',
      timezone: 'UTC',
      platforms: ['twitch'],
      createdAt: new Date(),
    }

    mockAuth.mockResolvedValueOnce({ user: { id: 'u1' } })

    mockDb.select.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([creatorRow]),
        })),
      })),
    }))

    const result = await requireCreator()
    expect(result).toEqual(creatorRow)
  })
})
