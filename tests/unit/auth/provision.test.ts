// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the db module — must be hoisted before any import that transitively needs it
vi.mock('@/db', () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
    },
  }
})

vi.mock('@/db/schema', () => ({
  creators: { userId: 'userId_col' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}))

import { provisionCreator } from '@/lib/provision'
import { db } from '@/db'

// Cast through unknown to avoid TypeScript overlap error between real db type and mock shape
const mockDb = db as unknown as {
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('provisionCreator', () => {
  it('inserts a new creator row when none exists and returns the created row', async () => {
    const createdRow = {
      id: 'c1',
      userId: 'u1',
      displayName: 'Streamer',
      timezone: 'UTC',
      platforms: ['twitch'],
      createdAt: new Date(),
    }

    // select returns empty — no existing row
    mockDb.select.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    }))

    // insert returns the created row
    mockDb.insert.mockImplementationOnce(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([createdRow]),
      })),
    }))

    const result = await provisionCreator('u1', 'Streamer')

    expect(result).toEqual(createdRow)
    expect(mockDb.insert).toHaveBeenCalledOnce()

    // Verify values include platforms: ['twitch']
    const valuesCall = mockDb.insert.mock.results[0]?.value?.values as ReturnType<typeof vi.fn>
    expect(valuesCall).toHaveBeenCalledWith(expect.objectContaining({ platforms: ['twitch'] }))
  })

  it('returns the existing row without inserting when creator already exists (idempotent)', async () => {
    const existingRow = {
      id: 'existing-1',
      userId: 'u2',
      displayName: 'OldName',
      timezone: 'UTC',
      platforms: ['twitch'],
      createdAt: new Date(),
    }

    // select returns existing row
    mockDb.select.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([existingRow]),
        })),
      })),
    }))

    const result = await provisionCreator('u2', 'OldName')

    expect(result).toEqual(existingRow)
    expect(mockDb.insert).not.toHaveBeenCalled()
  })

  it('falls back to DEFAULT_DISPLAY_NAME when displayName is blank', async () => {
    const createdRow = {
      id: 'c2',
      userId: 'u3',
      displayName: 'Creator',
      timezone: 'UTC',
      platforms: ['twitch'],
      createdAt: new Date(),
    }

    // select returns empty
    mockDb.select.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    }))

    // insert returns row with default display name
    mockDb.insert.mockImplementationOnce(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([createdRow]),
      })),
    }))

    const result = await provisionCreator('u3', '')

    expect(result).toEqual(createdRow)
    expect(mockDb.insert).toHaveBeenCalledOnce()

    const valuesCall = mockDb.insert.mock.results[0]?.value?.values as ReturnType<typeof vi.fn>
    expect(valuesCall).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Creator' }))
  })
})
