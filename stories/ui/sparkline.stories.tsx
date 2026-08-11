import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Sparkline } from '@/components/ui/chart/sparkline'
import { SERIES_COLOR } from '@/components/ui/chart/series-color'
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

// P-7: Sparkline's root is `height: 100%`, which resolves to zero in a parent
// with no definite height — and the preview canvas is exactly such a parent, so
// an unframed story renders a blank panel. The frame mirrors the shipped call
// site (`platform-card.tsx`, `h-8 w-full`), which is the point of the story.
const meta: Meta<typeof Sparkline> = {
  title: 'Chart/Sparkline',
  component: Sparkline,
  decorators: [
    function SparklineFrame(Story) {
      return (
        <div className="h-8 w-full">
          <Story />
        </div>
      )
    },
  ],
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
