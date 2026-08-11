import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlatformCard } from '@/components/dashboard/platform-card'
import type { MetricView, PlatformCardData } from '@/components/dashboard/serialize'

const DAY_MS = 86400000
const BASE_DAY = Date.UTC(2026, 7, 8)

function points(values: readonly (number | null)[]): MetricView['points'] {
  return values.map((v, index) => ({ t: BASE_DAY + index * DAY_MS, v }))
}

function metric(overrides: Partial<MetricView> = {}): MetricView {
  return {
    key: 'followers',
    label: 'Followers',
    value: 1120,
    delta: 120,
    points: points([1000, null, 1120]),
    ...overrides,
  }
}

function card(overrides: Partial<PlatformCardData> = {}): PlatformCardData {
  return {
    platform: 'twitch',
    title: 'Twitch',
    handle: 'nightowl',
    metrics: [metric()],
    live: { live: false },
    ...overrides,
  }
}

describe('PlatformCard', () => {
  it('heads the card with the platform and the linked handle', () => {
    render(<PlatformCard card={card()} />)

    expect(screen.getByRole('heading', { name: 'Twitch' })).toBeInTheDocument()
    expect(screen.getByText('nightowl')).toBeInTheDocument()
  })

  it('formats large values with thousands separators', () => {
    render(<PlatformCard card={card({ metrics: [metric({ value: 1204350 })] })} />)

    expect(screen.getByText('1,204,350')).toBeInTheDocument()
  })

  it('labels a point metric’s change as range growth', () => {
    render(<PlatformCard card={card()} />)

    expect(screen.getByText('+120 in range')).toBeInTheDocument()
  })

  it('signs a negative change and points its arrow down', () => {
    render(<PlatformCard card={card({ metrics: [metric({ delta: -40 })] })} />)

    expect(screen.getByText('-40 in range')).toBeInTheDocument()
    expect(screen.getByTestId('metric-trend-followers')).toHaveAttribute('data-direction', 'down')
  })

  it('shows a flat change with no direction', () => {
    render(<PlatformCard card={card({ metrics: [metric({ delta: 0 })] })} />)

    expect(screen.getByText('0 in range')).toBeInTheDocument()
    expect(screen.getByTestId('metric-trend-followers')).toHaveAttribute('data-direction', 'flat')
  })

  // P-14's second half: a summed metric must never render an arrow or an
  // "in range" growth figure, because its value already IS the range.
  it('describes a summed metric as a range total, with its unit and no arrow', () => {
    render(
      <PlatformCard
        card={card({
          platform: 'youtube',
          title: 'YouTube',
          live: null,
          metrics: [
            metric({
              key: 'watchTimeMin',
              label: 'Watch time',
              value: 270,
              unit: 'min',
              delta: null,
            }),
          ],
        })}
      />,
    )

    expect(screen.getByText('270 min')).toBeInTheDocument()
    expect(screen.getByText('summed over range')).toBeInTheDocument()
    expect(screen.queryByTestId('metric-trend-watchTimeMin')).not.toBeInTheDocument()
  })

  // P-7: Sparkline's root carries height:100%, which resolves to 0 in a parent
  // with no definite height — and happy-dom has no layout, so an invisible
  // sparkline passes every other assertion in this file. The frame's height
  // class is the only thing standing between the card and a blank strip.
  it('frames each sparkline in a container with a definite height', () => {
    render(<PlatformCard card={card()} />)

    expect(screen.getByTestId('metric-sparkline-followers')).toHaveClass('h-8')
  })

  it('draws the real sparkline geometry inside that frame', () => {
    render(
      <PlatformCard card={card({ metrics: [metric({ points: points([1000, 1080, 1120]) })] })} />,
    )

    const path = screen.getByTestId('metric-sparkline-followers').querySelector('path')
    expect(path?.getAttribute('d')).toMatch(/^M[\d.,]/)
  })

  // The default fixture's interior gap splits into two one-point segments, which
  // Sparkline draws as dots rather than paths — the shape a sparse range takes.
  it('draws isolated readings around a gap as dots', () => {
    render(<PlatformCard card={card()} />)

    const frame = screen.getByTestId('metric-sparkline-followers')
    expect(frame.querySelectorAll('circle')).toHaveLength(2)
    expect(frame.querySelector('path')).toBeNull()
  })

  it('badges a live Twitch channel with its current viewer count', () => {
    render(<PlatformCard card={card({ live: { live: true, ccv: 342 } })} />)

    expect(screen.getByText(/live/i)).toHaveTextContent('LIVE 342 watching')
  })

  it('badges a live channel with no reported viewer count', () => {
    render(<PlatformCard card={card({ live: { live: true } })} />)

    expect(screen.getByText(/live/i)).toHaveTextContent('LIVE')
    expect(screen.queryByText(/watching/i)).not.toBeInTheDocument()
  })

  it('shows no live badge when the channel is offline', () => {
    render(<PlatformCard card={card()} />)

    expect(screen.queryByText(/live/i)).not.toBeInTheDocument()
  })

  it('shows no live badge for a platform with no live concept', () => {
    render(<PlatformCard card={card({ platform: 'youtube', title: 'YouTube', live: null })} />)

    expect(screen.queryByText(/live/i)).not.toBeInTheDocument()
  })

  // A linked platform with no readings in the selected range: the page-level
  // empty state cannot fire, because a SIBLING platform has data. Without this
  // the card renders as a bare header over nothing.
  it('says so in the card when the platform has no metrics in range', () => {
    render(<PlatformCard card={card({ metrics: [] })} />)

    expect(screen.getByText('No Twitch data for this range yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Twitch' })).toBeInTheDocument()
  })

  it('names the platform it is empty for, rather than a fixed label', () => {
    render(<PlatformCard card={card({ platform: 'youtube', title: 'YouTube', metrics: [] })} />)

    expect(screen.getByText('No YouTube data for this range yet.')).toBeInTheDocument()
  })

  it('renders every metric it is given', () => {
    render(
      <PlatformCard
        card={card({
          metrics: [
            metric({ key: 'followers', label: 'Followers' }),
            metric({ key: 'subscribers', label: 'Subscribers', value: 25, delta: 5 }),
            metric({ key: 'subPoints', label: 'Sub points', value: 50, delta: 10 }),
          ],
        })}
      />,
    )

    expect(screen.getAllByTestId(/^metric-sparkline-/)).toHaveLength(3)
    expect(screen.getByText('Sub points')).toBeInTheDocument()
  })
})
