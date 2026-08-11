import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { ReauthBanner } from '@/components/dashboard/reauth-banner'
import type { PlatformAccountSummary } from '@/lib/platform-accounts'

const TWITCH: PlatformAccountSummary = {
  id: 'account-twitch',
  platform: 'twitch',
  handle: 'nightowl',
  status: 'reauth_required',
}

const YOUTUBE: PlatformAccountSummary = {
  id: 'account-youtube',
  platform: 'youtube',
  handle: 'nightowl-yt',
  status: 'reauth_required',
}

const meta: Meta<typeof ReauthBanner> = {
  title: 'Dashboard/ReauthBanner',
  component: ReauthBanner,
}

export default meta

type Story = StoryObj<typeof meta>

export const TwitchExpired: Story = {
  args: { accounts: [TWITCH] },
}

export const GoogleExpired: Story = {
  args: { accounts: [YOUTUBE] },
}

export const BothExpired: Story = {
  args: { accounts: [TWITCH, YOUTUBE] },
}

/** Every link healthy — the component renders nothing at all. */
export const AllHealthy: Story = {
  args: {
    accounts: [
      { ...TWITCH, status: 'active' },
      { ...YOUTUBE, status: 'active' },
    ],
  },
}
