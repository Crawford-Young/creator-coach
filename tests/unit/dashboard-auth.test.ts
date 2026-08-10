// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ObjectId } from 'mongodb'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

import { requireDashboardCreator } from '@/lib/dashboard-auth'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { collections, toCreator, type CreatorDoc, type PersonaProfileDoc } from '@/db'
// dashboard-auth never parses `data` — it only checks the document's
// existence — so this suite needs a profile that satisfies the type, not a
// bespoke one. Shared fixture, so a schema change can't leave one suite behind.
import { validPersonaProfile } from '../fixtures/persona-profile'

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>
const mockRedirect = redirect as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

function insertCreator(userId: string): Promise<CreatorDoc> {
  const doc: CreatorDoc = {
    _id: new ObjectId(),
    userId,
    displayName: 'Streamer',
    timezone: 'UTC',
    platforms: ['twitch'],
    createdAt: new Date(),
  }
  return collections()
    .creators.insertOne(doc)
    .then(() => doc)
}

function insertPersonaProfile(creatorId: string): Promise<PersonaProfileDoc> {
  const now = new Date()
  const doc: PersonaProfileDoc = {
    _id: new ObjectId(),
    creatorId,
    archetype: validPersonaProfile.identity.archetype,
    timezone: validPersonaProfile.constraints.timezone,
    data: validPersonaProfile,
    createdAt: now,
    updatedAt: now,
  }
  return collections()
    .personaProfiles.insertOne(doc)
    .then(() => doc)
}

describe('requireDashboardCreator', () => {
  it('redirects to /signin when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null)

    await expect(requireDashboardCreator()).rejects.toThrow('REDIRECT:/signin')
    expect(mockRedirect).toHaveBeenCalledWith('/signin')
  })

  it('redirects to /onboarding when the session has no creator doc', async () => {
    const userId = randomUUID()
    mockAuth.mockResolvedValueOnce({ user: { id: userId } })

    await expect(requireDashboardCreator()).rejects.toThrow('REDIRECT:/onboarding')
    expect(mockRedirect).toHaveBeenCalledWith('/onboarding')
  })

  it('redirects to /onboarding when the creator has no persona profile', async () => {
    const userId = randomUUID()
    const doc = await insertCreator(userId)
    mockAuth.mockResolvedValueOnce({ user: { id: userId } })

    await expect(requireDashboardCreator()).rejects.toThrow('REDIRECT:/onboarding')
    expect(mockRedirect).toHaveBeenCalledWith('/onboarding')
    // Sanity: the doc really has no matching persona profile in this test.
    const profile = await collections().personaProfiles.findOne({
      creatorId: doc._id.toHexString(),
    })
    expect(profile).toBeNull()
  })

  it('returns the mapped creator when session, creator doc, and persona profile all exist', async () => {
    const userId = randomUUID()
    const doc = await insertCreator(userId)
    await insertPersonaProfile(doc._id.toHexString())
    mockAuth.mockResolvedValueOnce({ user: { id: userId } })

    const result = await requireDashboardCreator()

    expect(result).toEqual(toCreator(doc))
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
