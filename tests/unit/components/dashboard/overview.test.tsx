import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DashboardOverview } from '@/components/dashboard/overview'
import {
  OFFLINE,
  OVERVIEW_NOW,
  OVERVIEW_SERIES,
  TWITCH_ACCOUNT,
  YOUTUBE_ACCOUNT,
} from '../../../fixtures/dashboard'

vi.mock('next-auth/react', () => ({ signIn: vi.fn().mockResolvedValue(undefined) }))

describe('DashboardOverview', () => {
  it('heads the surface and reflects the active range in the picker', () => {
    render(
      <DashboardOverview
        range="7d"
        accounts={[TWITCH_ACCOUNT]}
        series={OVERVIEW_SERIES}
        live={OFFLINE}
        now={OVERVIEW_NOW}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '7 days' })).toHaveAttribute('aria-current', 'page')
  })

  it('renders one card per linked platform', () => {
    render(
      <DashboardOverview
        range="7d"
        accounts={[TWITCH_ACCOUNT, YOUTUBE_ACCOUNT]}
        series={OVERVIEW_SERIES}
        live={OFFLINE}
        now={OVERVIEW_NOW}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Twitch' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'YouTube' })).toBeInTheDocument()
    // Scoped to the cards region: the same figure also appears in the audience
    // chart's visually-hidden data table, which is the chart's own a11y contract.
    const platforms = screen.getByRole('region', { name: 'Platforms' })
    expect(within(platforms).getByText('1,120')).toBeInTheDocument()
  })

  it('renders the audience overlay plus the two YouTube trend charts', () => {
    render(
      <DashboardOverview
        range="7d"
        accounts={[TWITCH_ACCOUNT, YOUTUBE_ACCOUNT]}
        series={OVERVIEW_SERIES}
        live={OFFLINE}
        now={OVERVIEW_NOW}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Followers & subscribers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Views' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Watch time (minutes per day)' }),
    ).toBeInTheDocument()
  })

  it('surfaces the reauth banner above the cards', () => {
    render(
      <DashboardOverview
        range="7d"
        accounts={[{ ...TWITCH_ACCOUNT, status: 'reauth_required' }]}
        series={OVERVIEW_SERIES}
        live={OFFLINE}
        now={OVERVIEW_NOW}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Twitch access for nightowl expired.')
    expect(screen.getByRole('heading', { name: 'Twitch' })).toBeInTheDocument()
  })

  it('points a creator with nothing linked at onboarding', () => {
    render(
      <DashboardOverview range="7d" accounts={[]} series={[]} live={OFFLINE} now={OVERVIEW_NOW} />,
    )

    expect(screen.getByRole('heading', { name: 'No platforms linked yet' })).toBeInTheDocument()
    expect(
      screen.getByText('Link your Twitch or YouTube account to start seeing your numbers here.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /link a platform/i })).toHaveAttribute(
      'href',
      '/onboarding',
    )
    expect(screen.queryByRole('heading', { name: 'Twitch' })).not.toBeInTheDocument()
  })

  // An empty series can mean "just connected" OR "picked a range that predates
  // the outage" — the copy has to be true of both, since the component cannot
  // tell them apart without a second query.
  it('tells a linked creator with no snapshots in range when to come back', () => {
    render(
      <DashboardOverview
        range="7d"
        accounts={[TWITCH_ACCOUNT]}
        series={[]}
        live={OFFLINE}
        now={OVERVIEW_NOW}
      />,
    )

    expect(screen.getByRole('heading', { name: 'No data for this range yet' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'If you just connected an account, your first sync runs tonight — check back tomorrow.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Twitch' })).not.toBeInTheDocument()
  })

  // The reauth banner is the one thing that must survive an empty dashboard —
  // an expired link is very often WHY there is no data.
  it('still shows the reauth banner when there are no snapshots', () => {
    render(
      <DashboardOverview
        range="7d"
        accounts={[{ ...TWITCH_ACCOUNT, status: 'reauth_required' }]}
        series={[]}
        live={OFFLINE}
        now={OVERVIEW_NOW}
      />,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No data for this range yet' })).toBeInTheDocument()
  })

  // Twitch linked, but only YouTube reported inside this range. The page-level
  // empty state is unreachable here — the series is not empty — so the silence
  // has to be stated on the card that has nothing to show.
  it('gives a linked platform with no in-range readings its own empty card', () => {
    render(
      <DashboardOverview
        range="7d"
        accounts={[TWITCH_ACCOUNT, YOUTUBE_ACCOUNT]}
        series={OVERVIEW_SERIES.filter((day) => day.platform === 'youtube')}
        live={OFFLINE}
        now={OVERVIEW_NOW}
      />,
    )

    expect(screen.getByText('No Twitch data for this range yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'YouTube' })).toBeInTheDocument()
    expect(screen.queryByText('No YouTube data for this range yet.')).not.toBeInTheDocument()
  })

  it('badges a live Twitch channel', () => {
    render(
      <DashboardOverview
        range="7d"
        accounts={[TWITCH_ACCOUNT]}
        series={OVERVIEW_SERIES}
        live={{ twitch: { live: true, ccv: 342 } }}
        now={OVERVIEW_NOW}
      />,
    )

    expect(screen.getByText(/live/i)).toHaveTextContent('LIVE 342 watching')
  })

  // The all-time axis has no arithmetic boundary — it starts at the earliest day
  // the series carries, so the chart still has to draw.
  it('renders charts for the all-time range', () => {
    render(
      <DashboardOverview
        range="all"
        accounts={[TWITCH_ACCOUNT]}
        series={OVERVIEW_SERIES}
        live={OFFLINE}
        now={OVERVIEW_NOW}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Followers & subscribers' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All time' })).toHaveAttribute('aria-current', 'page')
  })
})
