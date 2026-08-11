import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReauthBanner } from '@/components/dashboard/reauth-banner'
import { platformAccount, type PlatformAccountOverrides } from '../../../fixtures/dashboard'

vi.mock('next-auth/react', () => ({ signIn: vi.fn().mockResolvedValue(undefined) }))

// Every case here is about a link that STOPPED working, so this file's default
// is the broken one; the healthy cases say so explicitly.
function account(overrides: PlatformAccountOverrides = {}) {
  return platformAccount({ status: 'reauth_required', ...overrides })
}

describe('ReauthBanner', () => {
  it('renders nothing when no account needs reauthorization', () => {
    const { container } = render(<ReauthBanner accounts={[account({ status: 'active' })]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an empty account list', () => {
    const { container } = render(<ReauthBanner accounts={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('names the platform and handle that lost access', () => {
    render(<ReauthBanner accounts={[account({ handle: 'nightowl' })]} />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Twitch access for nightowl expired. Reconnect to keep your stats up to date.',
    )
  })

  it('offers the Twitch sign-in button for a Twitch account', () => {
    render(<ReauthBanner accounts={[account()]} />)

    expect(screen.getByRole('button', { name: /continue with twitch/i })).toBeInTheDocument()
  })

  it('links a YouTube account to the Google re-link route', () => {
    render(<ReauthBanner accounts={[account({ platform: 'youtube', handle: 'nightowl-yt' })]} />)

    expect(screen.getByRole('link', { name: /reconnect youtube/i })).toHaveAttribute(
      'href',
      '/api/connections/google/start',
    )
  })

  // TikTok and Instagram have no connector yet, so there is no re-link route to
  // point at. The banner still says so rather than hiding the problem.
  it('states the problem without an action for a platform with no re-link route', () => {
    render(<ReauthBanner accounts={[account({ platform: 'tiktok', handle: 'nightowl-tt' })]} />)

    expect(screen.getByRole('alert')).toHaveTextContent(/TikTok access for nightowl-tt expired/)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders one alert per account needing attention, skipping healthy ones', () => {
    render(
      <ReauthBanner
        accounts={[
          account({ id: 'a', platform: 'twitch' }),
          account({ id: 'b', platform: 'youtube', status: 'active' }),
          account({ id: 'c', platform: 'instagram' }),
        ]}
      />,
    )

    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })
})
