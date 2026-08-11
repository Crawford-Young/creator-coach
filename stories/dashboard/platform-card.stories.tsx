import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { PlatformCard } from '@/components/dashboard/platform-card'
import type { MetricView, PlatformCardData } from '@/components/dashboard/serialize'

const DAY_MS = 86400000
// Fixed calendar date — never Date.now() — so story output never drifts.
const BASE_DAY = Date.UTC(2026, 7, 1)

function points(values: readonly (number | null)[]): MetricView['points'] {
  return values.map((v, index) => ({ t: BASE_DAY + index * DAY_MS, v }))
}

const TWITCH_CARD: PlatformCardData = {
  platform: 'twitch',
  title: 'Twitch',
  handle: 'nightowl',
  live: { live: false },
  metrics: [
    {
      key: 'followers',
      label: 'Followers',
      value: 12130,
      delta: 130,
      points: points([12000, 12030, 12045, 12080, 12090, 12110, 12130]),
    },
    {
      key: 'subscribers',
      label: 'Subscribers',
      value: 214,
      delta: -6,
      points: points([220, 219, 219, 217, 216, 215, 214]),
    },
    {
      key: 'subPoints',
      label: 'Sub points',
      value: 288,
      delta: 0,
      points: points([288, 288, 288, 288, 288, 288, 288]),
    },
  ],
}

const meta: Meta<typeof PlatformCard> = {
  title: 'Dashboard/PlatformCard',
  component: PlatformCard,
}

export default meta

type Story = StoryObj<typeof meta>

export const Twitch: Story = {
  args: { card: TWITCH_CARD },
}

export const TwitchLive: Story = {
  args: { card: { ...TWITCH_CARD, live: { live: true, ccv: 342 } } },
}

export const YouTube: Story = {
  args: {
    card: {
      platform: 'youtube',
      title: 'YouTube',
      handle: 'nightowl-yt',
      live: null,
      metrics: [
        {
          key: 'subscribers',
          label: 'Subscribers',
          value: 8420,
          delta: 120,
          points: points([8300, 8330, 8350, 8370, 8390, 8405, 8420]),
        },
        {
          key: 'views',
          label: 'Views',
          value: 1204350,
          delta: 18400,
          points: points([1185950, 1189000, 1192400, 1196000, 1199100, 1201800, 1204350]),
        },
        {
          key: 'watchTimeMin',
          label: 'Watch time',
          unit: 'min',
          value: 41280,
          delta: null,
          points: points([5600, 6100, 5400, 6300, 5900, 6080, 5900]),
        },
      ],
    },
  },
}

// A sparse range: the connector missed two days, so those readings are gaps and
// the isolated ones render as dots rather than a line.
export const SparseRange: Story = {
  args: {
    card: {
      platform: 'twitch',
      title: 'Twitch',
      handle: 'nightowl',
      live: { live: false },
      metrics: [
        {
          key: 'followers',
          label: 'Followers',
          value: 12130,
          delta: 130,
          points: points([12000, null, null, 12080, 12090, null, 12130]),
        },
      ],
    },
  },
}
