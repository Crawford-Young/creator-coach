// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ObjectId } from 'mongodb'

vi.mock('@/lib/tenant', () => ({ requireCreator: vi.fn() }))

import { getPersonaProfile } from '@/lib/persona/get'
import { requireCreator } from '@/lib/tenant'
import { collections } from '@/db'
import { personaProfileSchema } from '@/lib/persona/schema'
import { validPersonaProfile as validProfile } from '../../fixtures/persona-profile'

const mockRequireCreator = requireCreator as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('getPersonaProfile', () => {
  it('returns null when no document exists for the session creator', async () => {
    const creatorId = randomUUID()
    mockRequireCreator.mockResolvedValueOnce({ id: creatorId })

    const result = await getPersonaProfile()

    expect(result).toBeNull()
  })

  it('returns the parsed profile when a document exists, scoped to the session creator', async () => {
    const creatorId = randomUUID()
    mockRequireCreator.mockResolvedValueOnce({ id: creatorId })
    const now = new Date()
    await collections().personaProfiles.insertOne({
      _id: new ObjectId(),
      creatorId,
      archetype: validProfile.identity.archetype,
      timezone: validProfile.constraints.timezone,
      data: validProfile,
      createdAt: now,
      updatedAt: now,
    })

    const result = await getPersonaProfile()

    expect(result).toEqual(personaProfileSchema.parse(validProfile))
  })

  it('propagates a requireCreator failure', async () => {
    const authError = new Error('Not authenticated')
    mockRequireCreator.mockRejectedValueOnce(authError)

    await expect(getPersonaProfile()).rejects.toThrow('Not authenticated')
  })
})
