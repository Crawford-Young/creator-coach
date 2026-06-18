// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/tenant', () => ({ requireCreator: vi.fn() }))
vi.mock('@/db', () => ({ db: { insert: vi.fn() } }))
vi.mock('@/db/schema', () => ({ personaProfiles: { creatorId: 'creator_id_col' } }))

import { savePersonaProfile } from '@/lib/actions/persona'
import { requireCreator } from '@/lib/tenant'
import { db } from '@/db'

const mockRequireCreator = requireCreator as unknown as ReturnType<typeof vi.fn>
const mockDb = db as unknown as { insert: ReturnType<typeof vi.fn> }

const validProfile = {
  identity: { mainDraw: 'community heart', archetype: 'community-heart' },
  contentPillars: {
    anchor: { name: 'CS2', mode: 'ranked + squad nights' },
    rotation: ['Valorant'],
  },
  voice: {
    toneWords: ['calm'],
    sampleLines: ['gg'],
    dos: ['uplift'],
    donts: ['rage'],
    wildcardDial: 6,
  },
  philosophy: { values: ['care'], statement: 'people first' },
  audience: { description: 'the campfire', servesWho: 'regulars' },
  constraints: {
    timezone: 'Europe/London',
    weeklySchedule: 'eves',
    collabAvailability: 'weekends',
  },
  sustainability: {
    energyPatterns: 'morning low',
    burnoutTriggers: ['over-streaming'],
    restNeeds: '1 day/wk',
  },
  platforms: { primary: { type: 'twitch', handle: 'x' }, clipTargets: ['tiktok'] },
}

beforeEach(() => vi.clearAllMocks())

describe('savePersonaProfile', () => {
  it('rejects invalid payload and does not call db.insert', async () => {
    mockRequireCreator.mockResolvedValueOnce({ id: 'cr1' })

    await expect(savePersonaProfile({})).rejects.toThrow()

    expect(mockDb.insert).not.toHaveBeenCalled()
  })

  it('upserts scoped to the session creator on valid input', async () => {
    mockRequireCreator.mockResolvedValueOnce({ id: 'cr1' })

    const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
    const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }))
    mockDb.insert.mockReturnValueOnce({ values: mockValues })

    const result = await savePersonaProfile(validProfile)

    expect(result).toEqual({ ok: true })
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorId: 'cr1',
        archetype: 'community-heart',
        timezone: 'Europe/London',
        data: expect.objectContaining({ identity: expect.anything() }),
      }),
    )
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.anything(),
        set: expect.objectContaining({
          updatedAt: expect.any(Date),
        }),
      }),
    )
  })

  it('propagates auth failure and does not call db.insert', async () => {
    const authError = new Error('Not authenticated')
    mockRequireCreator.mockRejectedValueOnce(authError)

    await expect(savePersonaProfile(validProfile)).rejects.toThrow('Not authenticated')

    expect(mockDb.insert).not.toHaveBeenCalled()
  })
})
