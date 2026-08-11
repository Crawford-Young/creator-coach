import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { axe } from 'jest-axe'
import { TrendChart, type TrendSeries } from '@/components/ui/chart/trend-chart'
import { SERIES_COLOR } from '@/components/ui/chart/series-color'
import { Sparkline } from '@/components/ui/chart/sparkline'
import type { ChartPoint } from '@/components/ui/chart/segment'

const DAY_MS = 86400000

// Deliberately tiny: axe over happy-dom is slow, and none of the accessible
// structure (table shape, legend, landmark nesting) varies with series length.
const TWITCH_VALUES = [1200, 1240, null, 1310]
const YOUTUBE_VALUES = [400, 415, 430, 445]

function pointsFrom(values: readonly (number | null)[]): ChartPoint[] {
  return values.map((v, index) => ({ t: index * DAY_MS, v }))
}

const TWITCH: TrendSeries = {
  id: 'twitch',
  label: 'Twitch followers',
  points: pointsFrom(TWITCH_VALUES),
}
const YOUTUBE: TrendSeries = {
  id: 'youtube',
  label: 'YouTube subscribers',
  points: pointsFrom(YOUTUBE_VALUES),
}

// Reporting rule ids rather than the raw result objects keeps a failure
// readable — the whole AxeResults dump is unusable as an assertion diff.
async function violationIds(container: HTMLElement): Promise<string[]> {
  const results = await axe(container)
  return results.violations.map((violation) => violation.id)
}

describe('chart accessibility', () => {
  it('raises no violations with both charts on real data', async () => {
    const { container } = render(
      <main>
        <TrendChart title="Audience growth" series={[TWITCH, YOUTUBE]} range="7d" />
        <Sparkline points={pointsFrom(TWITCH_VALUES)} color={SERIES_COLOR.twitch} />
      </main>,
    )

    expect(await violationIds(container)).toEqual([])
  })

  it('raises no violations in the empty state', async () => {
    const { container } = render(
      <main>
        <TrendChart title="Audience growth" series={[]} range="7d" />
        <Sparkline points={[]} color={SERIES_COLOR.twitch} />
      </main>,
    )

    expect(await violationIds(container)).toEqual([])
  })
})
