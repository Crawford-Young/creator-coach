// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ObjectId } from 'mongodb'

vi.mock('@/lib/tenant', () => ({ requireCreator: vi.fn() }))

import { getPersonaProfile } from '@/lib/persona/get'
import { requireCreator } from '@/lib/tenant'
import { collections } from '@/db/mongo'
import { personaProfileSchema } from '@/lib/persona/schema'

const mockRequireCreator = requireCreator as unknown as ReturnType<typeof vi.fn>

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
