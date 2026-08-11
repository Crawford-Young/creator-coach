import type { DayMetrics } from '@/lib/metrics/query'
import type { LiveStatus } from '@/lib/metrics/live'
import type { PlatformAccountSummary } from '@/lib/platform-accounts'
import type { Platform } from '@/db'

/** Fixed instant so every day axis derived from it is stable across runs. */
export const OVERVIEW_NOW = Date.UTC(2026, 7, 10, 12)

export type PlatformAccountOverrides = Partial<PlatformAccountSummary>

/** Healthy by default — a test needing a broken link overrides `status`. */
export function platformAccount(overrides: PlatformAccountOverrides = {}): PlatformAccountSummary {
  return {
    id: 'account-id',
    platform: 'twitch',
    handle: 'nightowl',
    status: 'active',
    ...overrides,
  }
}

export const TWITCH_ACCOUNT: PlatformAccountSummary = platformAccount({ id: 'account-twitch' })

export const YOUTUBE_ACCOUNT: PlatformAccountSummary = platformAccount({
  id: 'account-youtube',
  platform: 'youtube',
  handle: 'nightowl-yt',
})

/** No platform reports live — the shape `getLiveStatuses` returns for none. */
export const OFFLINE: Partial<Record<Platform, LiveStatus>> = { twitch: { live: false } }

// Two readings a day apart inside every preset window, so deltas are non-zero
// and the day axis carries a real gap between them.
export const OVERVIEW_SERIES: readonly DayMetrics[] = [
  {
    day: '2026-08-08',
    platform: 'twitch',
    metrics: { followers: 1000, subscribers: 20, subPoints: 40 },
  },
  {
    day: '2026-08-08',
    platform: 'youtube',
    metrics: { subscribers: 500, views: 90000, watchTimeMin: 120 },
  },
  {
    day: '2026-08-10',
    platform: 'twitch',
    metrics: { followers: 1120, subscribers: 25, subPoints: 50 },
  },
  {
    day: '2026-08-10',
    platform: 'youtube',
    metrics: { subscribers: 540, views: 92000, watchTimeMin: 150 },
  },
]
