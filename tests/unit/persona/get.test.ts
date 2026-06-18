// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/tenant', () => ({ requireCreator: vi.fn() }))
vi.mock('@/db', () => ({ db: { select: vi.fn() } }))
vi.mock('@/db/schema', () => ({ personaProfiles: { creatorId: 'creator_id_col' } }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((col, val) => ({ col, val })) }))

import { getPersonaProfile } from '@/lib/persona/get'
import { requireCreator } from '@/lib/tenant'
import { db } from '@/db'

const mockRequireCreator = requireCreator as unknown as ReturnType<typeof vi.fn>
const mockDb = db as unknown as { select: ReturnType<typeof vi.fn> }

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

describe('getPersonaProfile', () => {
  it('returns null when no row exists and calls requireCreator', async () => {
    mockRequireCreator.mockResolvedValueOnce({ id: 'cr1' })

    mockDb.select.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    }))

    const result = await getPersonaProfile()

    expect(result).toBeNull()
    expect(mockRequireCreator).toHaveBeenCalledOnce()
  })

  it('returns the parsed profile when a row exists, scoped to session creator', async () => {
    mockRequireCreator.mockResolvedValueOnce({ id: 'cr1' })

    mockDb.select.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{ data: validProfile }]),
        })),
      })),
    }))

    const result = await getPersonaProfile()

    expect(result).toEqual(validProfile)
    expect(mockRequireCreator).toHaveBeenCalledOnce()
  })

  it('propagates auth/tenant failure and does not call db.select', async () => {
    const authError = new Error('Not authenticated')
    mockRequireCreator.mockRejectedValueOnce(authError)

    await expect(getPersonaProfile()).rejects.toThrow('Not authenticated')

    expect(mockDb.select).not.toHaveBeenCalled()
  })
})
