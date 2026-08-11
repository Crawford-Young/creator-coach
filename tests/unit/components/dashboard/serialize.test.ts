import { describe, expect, it } from 'vitest'
import { toOverviewCharts, toPlatformCards } from '@/components/dashboard/serialize'
import type { DayMetrics } from '@/lib/metrics/query'
import type { LiveStatus } from '@/lib/metrics/live'
import type { Platform } from '@/db'
import {
  OFFLINE,
  OVERVIEW_SERIES as SERIES,
  platformAccount as account,
} from '../../../fixtures/dashboard'

// The fixture series carries no row for 2026-08-09, so every sparkline
// assertion here also proves the day axis is projected rather than compacted.
const RANGE_DAYS = ['2026-08-08', '2026-08-09', '2026-08-10']
const DAY_8 = Date.UTC(2026, 7, 8)
const DAY_9 = Date.UTC(2026, 7, 9)
const DAY_10 = Date.UTC(2026, 7, 10)

describe('toPlatformCards', () => {
  it('builds a Twitch card from the connector’s own metric keys', () => {
    const [card] = toPlatformCards([account()], SERIES, RANGE_DAYS, OFFLINE)

    expect(card.platform).toBe('twitch')
    expect(card.title).toBe('Twitch')
    expect(card.handle).toBe('nightowl')
    expect(card.metrics.map((metric) => metric.label)).toEqual([
      'Followers',
      'Subscribers',
      'Sub points',
    ])
  })

  it('reports a point metric as its latest value plus the range delta', () => {
    const [card] = toPlatformCards([account()], SERIES, RANGE_DAYS, OFFLINE)
    const followers = card.metrics.find((metric) => metric.key === 'followers')

    expect(followers?.value).toBe(1120)
    expect(followers?.delta).toBe(120)
  })

  // P-14: `views` is classified 'point', so the figure on the card is the
  // cumulative lifetime total and the delta is GROWTH over the range — never a
  // sum of per-day views. A regression to sum semantics would read 182000.
  it('reports YouTube views as a cumulative total with a growth delta, never a sum', () => {
    const [card] = toPlatformCards([account({ platform: 'youtube' })], SERIES, RANGE_DAYS, OFFLINE)
    const views = card.metrics.find((metric) => metric.key === 'views')

    expect(views?.value).toBe(92000)
    expect(views?.delta).toBe(2000)
  })

  // The other half of P-14: watch time is the one genuine 'daily' metric here,
  // so its value IS the range sum and it carries no delta to render an arrow
  // against.
  it('reports watch time as the range sum with no delta', () => {
    const [card] = toPlatformCards([account({ platform: 'youtube' })], SERIES, RANGE_DAYS, OFFLINE)
    const watchTime = card.metrics.find((metric) => metric.key === 'watchTimeMin')

    expect(watchTime?.value).toBe(270)
    expect(watchTime?.delta).toBeNull()
    expect(watchTime?.unit).toBe('min')
  })

  it('projects sparkline points onto the full day axis, gaps included', () => {
    const [card] = toPlatformCards([account()], SERIES, RANGE_DAYS, OFFLINE)
    const followers = card.metrics.find((metric) => metric.key === 'followers')

    expect(followers?.points).toEqual([
      { t: DAY_8, v: 1000 },
      { t: DAY_9, v: null },
      { t: DAY_10, v: 1120 },
    ])
  })

  it('omits a metric the series never carried rather than showing a zero', () => {
    const thin: readonly DayMetrics[] = [
      { day: '2026-08-10', platform: 'twitch', metrics: { followers: 1120 } },
    ]

    const [card] = toPlatformCards([account()], thin, RANGE_DAYS, OFFLINE)

    expect(card.metrics.map((metric) => metric.key)).toEqual(['followers'])
  })

  // Which platforms can be live is `getLiveStatuses`'s business now: this only
  // matches each card to its own entry, and reports null where there is none.
  it('gives each card the live status reported for its platform, null where none was', () => {
    const twitchLive: LiveStatus = { live: true, ccv: 342 }
    const live: Partial<Record<Platform, LiveStatus>> = { twitch: twitchLive }
    const cards = toPlatformCards(
      [account(), account({ platform: 'youtube', handle: 'nightowl-yt' })],
      SERIES,
      RANGE_DAYS,
      live,
    )

    expect(cards[0].live).toEqual(twitchLive)
    expect(cards[1].live).toBeNull()
  })

  it('skips a linked platform that has no card definition yet', () => {
    const cards = toPlatformCards(
      [account({ platform: 'tiktok' }), account({ platform: 'youtube' })],
      SERIES,
      RANGE_DAYS,
      OFFLINE,
    )

    expect(cards.map((card) => card.platform)).toEqual(['youtube'])
  })
})

describe('toOverviewCharts', () => {
  it('builds the audience overlay plus the two YouTube-only charts', () => {
    const charts = toOverviewCharts(SERIES, ['twitch', 'youtube'], RANGE_DAYS)

    expect(charts.map((chart) => chart.title)).toEqual([
      'Followers & subscribers',
      'Views',
      'Watch time (minutes per day)',
    ])
  })

  it('overlays Twitch followers and YouTube subscribers on the audience chart', () => {
    const [audience] = toOverviewCharts(SERIES, ['twitch', 'youtube'], RANGE_DAYS)

    expect(audience.series.map((entry) => [entry.id, entry.label])).toEqual([
      ['twitch', 'Twitch followers'],
      ['youtube', 'YouTube subscribers'],
    ])
    expect(audience.series[0].points).toEqual([
      { t: DAY_8, v: 1000 },
      { t: DAY_9, v: null },
      { t: DAY_10, v: 1120 },
    ])
  })

  // Twitch writes no channel-scope views and no watch time, so those charts are
  // single-series by construction — and must not exist at all for a creator who
  // only linked Twitch, rather than rendering two permanently empty panels.
  it('drops charts whose only platform is not linked', () => {
    const charts = toOverviewCharts(SERIES, ['twitch'], RANGE_DAYS)

    expect(charts.map((chart) => chart.id)).toEqual(['audience'])
    expect(charts[0].series.map((entry) => entry.id)).toEqual(['twitch'])
  })

  it('returns no charts when nothing is linked', () => {
    expect(toOverviewCharts(SERIES, [], RANGE_DAYS)).toEqual([])
  })
})
