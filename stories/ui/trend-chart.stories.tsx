import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { TrendChart, type TrendSeries } from '@/components/ui/chart/trend-chart'
import type { ChartPoint } from '@/components/ui/chart/segment'

const DAY_MS = 86400000
// Fixed calendar date — never Date.now() — so story output never drifts.
const BASE_DAY = Date.UTC(2026, 7, 1)

function day(offset: number): number {
  return BASE_DAY + offset * DAY_MS
}

function points(values: readonly (number | null)[]): ChartPoint[] {
  return values.map((value, index) => ({ t: day(index), v: value }))
}

const TWITCH_SERIES: TrendSeries = {
  id: 'twitch',
  label: 'Twitch followers',
  points: points([12000, 12030, 12045, 12080, 12090, 12110, 12130]),
}

const YOUTUBE_SERIES: TrendSeries = {
  id: 'youtube',
  label: 'YouTube subscribers',
  points: points([5000, 5020, 4990, 5040, 5060, 5080, 5100]),
}

const TWITCH_WITH_GAPS: TrendSeries = {
  id: 'twitch',
  label: 'Twitch followers',
  points: points([12000, 12030, null, null, 12090, 12110, 12130]),
}

const meta: Meta<typeof TrendChart> = {
  title: 'Chart/TrendChart',
  component: TrendChart,
}

export default meta

type Story = StoryObj<typeof meta>

export const MultiSeries: Story = {
  args: {
    title: 'Followers vs subscribers',
    series: [TWITCH_SERIES, YOUTUBE_SERIES],
    range: '7d',
  },
}

export const WithGaps: Story = {
  args: {
    title: 'Twitch followers (outage gap)',
    series: [TWITCH_WITH_GAPS],
    range: '7d',
  },
}

export const SingleSeries: Story = {
  args: {
    title: 'Twitch followers',
    series: [TWITCH_SERIES],
    range: '7d',
  },
}

export const Empty: Story = {
  args: {
    title: 'Followers vs subscribers',
    series: [],
    range: '7d',
  },
}
