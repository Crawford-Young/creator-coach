import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PersonaWizard } from '@/components/onboarding/persona-wizard'
import { savePersonaProfile } from '@/lib/actions/persona'
import type { PersonaProfile } from '@/lib/persona/schema'
import { toast } from '@/lib/ui'

vi.mock('@/lib/actions/persona', () => ({
  savePersonaProfile: vi.fn().mockResolvedValue({ ok: true }),
}))

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

vi.mock('@/lib/ui', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ui')>('@/lib/ui')
  return {
    ...actual,
    toast: { success: vi.fn(), error: vi.fn() },
  }
})

const savePersonaProfileMock = vi.mocked(savePersonaProfile)

const toastSuccess = vi.mocked(toast.success)
const toastError = vi.mocked(toast.error)

beforeEach(() => {
  push.mockClear()
  savePersonaProfileMock.mockClear()
  savePersonaProfileMock.mockResolvedValue({ ok: true })
  toastSuccess.mockClear()
  toastError.mockClear()
})

type WizardUser = ReturnType<typeof userEvent.setup>

async function completeAllSteps(user: WizardUser, fillPlatforms = true): Promise<void> {
  await user.type(screen.getByLabelText(/main draw/i), 'Honest tutorials')
  await user.type(screen.getByLabelText(/archetype/i), 'The Mentor')
  await user.click(screen.getByRole('button', { name: /next/i }))

  await user.type(screen.getByLabelText(/anchor name/i), 'Deep Dives')
  await user.type(screen.getByLabelText(/anchor mode/i), 'long-form')
  await user.click(screen.getByRole('button', { name: /next/i }))

  const dial = screen.getByLabelText(/wildcard dial/i)
  await user.clear(dial)
  await user.type(dial, '7')
  await user.click(screen.getByRole('button', { name: /next/i }))

  await user.type(screen.getByLabelText(/statement/i), 'Teach with care')
  await user.click(screen.getByRole('button', { name: /next/i }))

  await user.type(screen.getByLabelText(/description/i), 'Beginner devs')
  await user.type(screen.getByLabelText(/serves who/i), 'New coders')
  await user.click(screen.getByRole('button', { name: /next/i }))

  await user.type(screen.getByLabelText(/timezone/i), 'America/New_York')
  await user.type(screen.getByLabelText(/weekly schedule/i), 'Mon and Wed')
  await user.type(screen.getByLabelText(/collab availability/i), 'Weekends')
  await user.click(screen.getByRole('button', { name: /next/i }))

  await user.type(screen.getByLabelText(/energy patterns/i), 'Mornings best')
  await user.type(screen.getByLabelText(/rest needs/i), 'One day off')
  await user.click(screen.getByRole('button', { name: /next/i }))

  if (!fillPlatforms) return
  await user.type(screen.getByLabelText(/platform type/i), 'youtube')
  await user.type(screen.getByLabelText(/handle/i), '@mentor')
}

describe('PersonaWizard', () => {
  it('renders the identity step first', () => {
    render(<PersonaWizard />)
    expect(screen.getByLabelText(/main draw/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/archetype/i)).toBeInTheDocument()
  })

  it('blocks advancing and shows an error when the current step is invalid', async () => {
    const user = userEvent.setup()
    render(<PersonaWizard />)

    await user.click(screen.getByRole('button', { name: /next/i }))

    // Still on identity step (error rendered, did not advance)
    expect(screen.getByLabelText(/main draw/i)).toBeInTheDocument()
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
  })

  it('walks every step, uses Back, and submits an assembled profile', async () => {
    const user = userEvent.setup()
    render(<PersonaWizard />)

    // Step 1: Identity
    await user.type(screen.getByLabelText(/main draw/i), 'Honest tutorials')
    await user.type(screen.getByLabelText(/archetype/i), 'The Mentor')
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Step 2: Content Pillars
    await user.type(screen.getByLabelText(/anchor name/i), 'Deep Dives')
    await user.type(screen.getByLabelText(/anchor mode/i), 'long-form')
    // trailing comma exercises toArray filter(Boolean)
    await user.type(screen.getByLabelText(/rotation/i), 'news, tips,')
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Use Back, then forward again to cover the back branch
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByLabelText(/anchor name/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Step 3: Voice
    await user.type(screen.getByLabelText(/tone words/i), 'warm, direct')
    await user.type(screen.getByLabelText(/sample lines/i), 'Let us dig in')
    await user.type(screen.getByLabelText(/^dos/i), 'be kind')
    await user.type(screen.getByLabelText(/don'?ts/i), 'be vague')
    const dial = screen.getByLabelText(/wildcard dial/i)
    await user.clear(dial)
    await user.type(dial, '7')
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Step 4: Philosophy
    await user.type(screen.getByLabelText(/values/i), 'craft, honesty')
    await user.type(screen.getByLabelText(/statement/i), 'Teach with care')
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Step 5: Audience
    await user.type(screen.getByLabelText(/description/i), 'Beginner devs')
    await user.type(screen.getByLabelText(/serves who/i), 'New coders')
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Step 6: Constraints
    await user.type(screen.getByLabelText(/timezone/i), 'America/New_York')
    await user.type(screen.getByLabelText(/weekly schedule/i), 'Mon and Wed')
    await user.type(screen.getByLabelText(/collab availability/i), 'Weekends')
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Step 7: Sustainability
    await user.type(screen.getByLabelText(/energy patterns/i), 'Mornings best')
    await user.type(screen.getByLabelText(/burnout triggers/i), 'crunch, noise')
    await user.type(screen.getByLabelText(/rest needs/i), 'One day off')
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Step 8: Platforms
    await user.type(screen.getByLabelText(/platform type/i), 'youtube')
    await user.type(screen.getByLabelText(/handle/i), '@mentor')
    await user.type(screen.getByLabelText(/clip targets/i), 'tiktok, shorts')

    await user.click(screen.getByRole('button', { name: /submit/i }))

    expect(savePersonaProfileMock).toHaveBeenCalledTimes(1)
    const payload = savePersonaProfileMock.mock.calls[0][0] as PersonaProfile
    expect(payload.identity.archetype).toBe('The Mentor')
    expect(payload.contentPillars.rotation).toEqual(['news', 'tips'])
    expect(Array.isArray(payload.platforms.clipTargets)).toBe(true)
    expect(payload.platforms.clipTargets).toEqual(['tiktok', 'shorts'])
    expect(payload.voice.wildcardDial).toBe(7)
    expect(push).toHaveBeenCalledWith('/')
  })

  it('blocks advancing when the wildcard dial is out of range', async () => {
    const user = userEvent.setup()
    render(<PersonaWizard />)

    await user.type(screen.getByLabelText(/main draw/i), 'Honest tutorials')
    await user.type(screen.getByLabelText(/archetype/i), 'The Mentor')
    await user.click(screen.getByRole('button', { name: /next/i }))

    await user.type(screen.getByLabelText(/anchor name/i), 'Deep Dives')
    await user.type(screen.getByLabelText(/anchor mode/i), 'long-form')
    await user.click(screen.getByRole('button', { name: /next/i }))

    const dial = screen.getByLabelText(/wildcard dial/i)
    await user.clear(dial)
    await user.type(dial, '11')
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Still on the voice step, error surfaced, did not advance.
    expect(screen.getByLabelText(/wildcard dial/i)).toBeInTheDocument()
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
  })

  it('blocks submitting when the final step is incomplete', async () => {
    const user = userEvent.setup()
    render(<PersonaWizard />)

    await completeAllSteps(user, false)
    // Only fill one of the two required platform fields, leave handle empty.
    await user.type(screen.getByLabelText(/platform type/i), 'youtube')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    expect(savePersonaProfileMock).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
  })

  it('surfaces an error toast and stays put when the save fails', async () => {
    savePersonaProfileMock.mockRejectedValueOnce(new Error('save failed'))
    const user = userEvent.setup()
    render(<PersonaWizard />)

    await completeAllSteps(user)
    await user.click(screen.getByRole('button', { name: /submit/i }))

    expect(savePersonaProfileMock).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    // Submit becomes available again after the failure (not stuck disabled).
    expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled()
  })
})
