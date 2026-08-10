import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Sparkline } from '@/components/ui/chart/sparkline'
import { SERIES_COLOR } from '@/components/ui/chart/trend-chart'
import type { ChartPoint } from '@/components/ui/chart/segment'

const DAY_MS = 86400000
// Fixed calendar date — never Date.now() — so story output never drifts.
const BASE_DAY = Date.UTC(2026, 7, 1)

function day(offset: number): number {
  return BASE_DAY + offset * DAY_MS
}

function points(values: readonly number[]): ChartPoint[] {
  return values.map((value, index) => ({ t: day(index), v: value }))
}

const meta: Meta<typeof Sparkline> = {
  title: 'Chart/Sparkline',
  component: Sparkline,
}

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    points: points([12000, 12030, 12045, 12080, 12090, 12110, 12130]),
    color: SERIES_COLOR.twitch,
  },
}

export const SinglePoint: Story = {
  args: {
    points: points([12080]),
    color: SERIES_COLOR.youtube,
  },
}

export const Empty: Story = {
  args: {
    points: [],
    color: SERIES_COLOR.twitch,
  },
}
