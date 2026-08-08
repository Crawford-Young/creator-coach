// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/tenant', () => ({ requireCreator: vi.fn() }))

import { savePersonaProfile } from '@/lib/actions/persona'
import { requireCreator } from '@/lib/tenant'
import { collections } from '@/db'

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

describe('savePersonaProfile', () => {
  it('rejects an invalid payload and does not insert a document', async () => {
    const creatorId = randomUUID()
    mockRequireCreator.mockResolvedValueOnce({ id: creatorId })

    await expect(savePersonaProfile({})).rejects.toThrow()

    await expect(collections().personaProfiles.countDocuments({ creatorId })).resolves.toBe(0)
  })

  it('upserts a document scoped to the session creator on valid input', async () => {
    const creatorId = randomUUID()
    mockRequireCreator.mockResolvedValueOnce({ id: creatorId })

    const result = await savePersonaProfile(validProfile)

    expect(result).toEqual({ ok: true })
    const doc = await collections().personaProfiles.findOne({ creatorId })
    expect(doc).not.toBeNull()
    expect(doc?.creatorId).toBe(creatorId)
    expect(doc?.archetype).toBe('community-heart')
    expect(doc?.timezone).toBe('Europe/London')
    expect(doc?.data).toEqual(validProfile)
  })

  it('is idempotent for a second save by the same creator — updates the single document in place', async () => {
    const creatorId = randomUUID()
    mockRequireCreator.mockResolvedValue({ id: creatorId })

    await savePersonaProfile(validProfile)
    const first = await collections().personaProfiles.findOne({ creatorId })

    const updatedProfile = {
      ...validProfile,
      philosophy: { ...validProfile.philosophy, statement: 'community first' },
    }
    await savePersonaProfile(updatedProfile)
    const second = await collections().personaProfiles.findOne({ creatorId })

    await expect(collections().personaProfiles.countDocuments({ creatorId })).resolves.toBe(1)
    expect(second?.data.philosophy.statement).toBe('community first')
    expect(second?.createdAt).toEqual(first?.createdAt)
    expect(second?.updatedAt.getTime()).toBeGreaterThan(first?.updatedAt.getTime() ?? 0)
  })

  it('propagates a requireCreator failure and does not insert a document', async () => {
    const authError = new Error('Not authenticated')
    mockRequireCreator.mockRejectedValueOnce(authError)
    const before = await collections().personaProfiles.countDocuments()

    await expect(savePersonaProfile(validProfile)).rejects.toThrow('Not authenticated')

    const after = await collections().personaProfiles.countDocuments()
    expect(after).toBe(before)
  })
})
