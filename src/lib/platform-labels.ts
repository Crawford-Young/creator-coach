import type { Platform } from '@/db'

/**
 * The one human-readable name per platform. Every surface that names a
 * platform — cards, banners, future settings rows — indexes into this, so a
 * rename lands everywhere at once. Type-only import of `Platform`, so this
 * module stays free of the mongodb driver and is safe anywhere.
 */
export const PLATFORM_LABEL: Readonly<Record<Platform, string>> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
}
