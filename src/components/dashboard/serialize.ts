import type { Platform } from '@/db'
import type { PlatformAccountSummary } from '@/lib/platform-accounts'
import type { DayMetrics } from '@/lib/metrics/query'
import type { LiveStatus } from '@/lib/metrics/live'
import { computeDeltas, type MetricDelta, type MetricKey } from '@/lib/metrics/deltas'
import { PLATFORM_LABEL } from '@/lib/platform-labels'
import { toChartPoints, type ChartPoint } from '@/components/ui/chart/segment'
import type { TrendSeries } from '@/components/ui/chart/trend-chart'

/** The platforms the Overview has a card and a chart series for. */
export type CardPlatform = TrendSeries['id']

export interface MetricView {
  readonly key: string
  readonly label: string
  /**
   * A point metric's latest in-range value (followers, subscribers, views —
   * cumulative running totals), or a daily metric's SUM across the range
   * (watch time). `delta` is what tells the two apart.
   */
  readonly value: number
  readonly unit?: string
  /**
   * Growth over the range for a point metric, or `null` when `value` is
   * already a range sum and no first-vs-last comparison is meaningful.
   */
  readonly delta: number | null
  readonly points: readonly ChartPoint[]
}

export interface PlatformCardData {
  readonly platform: CardPlatform
  readonly title: string
  readonly handle: string
  readonly metrics: readonly MetricView[]
  /** Twitch only — every other platform has no live concept, hence null. */
  readonly live: LiveStatus | null
}

export interface OverviewChart {
  readonly id: string
  readonly title: string
  readonly series: readonly TrendSeries[]
}

interface MetricSpec {
  /**
   * Only a key `METRIC_KINDS` classifies. An unclassified key yields no delta
   * entry, and `toMetricViews` then drops the metric block entirely — a card
   * row that silently disappears. This type is what turns that into a compile
   * error at the spec below.
   */
  readonly key: MetricKey
  readonly label: string
  readonly unit?: string
}

interface ChartSeriesSpec {
  readonly platform: CardPlatform
  readonly metric: string
  readonly label: string
}

interface ChartSpec {
  readonly id: string
  readonly title: string
  readonly series: readonly ChartSeriesSpec[]
}

// Only keys a connector actually writes at channel scope: Twitch has no
// channel-scope views and no watch time (twitch.ts:299-308), and the YouTube
// analytics path deliberately never writes views (P-14).
const CARD_METRICS: Readonly<Record<CardPlatform, readonly MetricSpec[]>> = {
  twitch: [
    { key: 'followers', label: 'Followers' },
    { key: 'subscribers', label: 'Subscribers' },
    { key: 'subPoints', label: 'Sub points' },
  ],
  youtube: [
    { key: 'subscribers', label: 'Subscribers' },
    { key: 'views', label: 'Views' },
    { key: 'watchTimeMin', label: 'Watch time', unit: 'min' },
  ],
}

// The audience chart is the only overlay; the other two are single-series
// because Twitch supplies neither metric. TrendChart hides its legend below two
// series, which is the right call for those.
const CHART_SPECS: readonly ChartSpec[] = [
  {
    id: 'audience',
    title: 'Followers & subscribers',
    series: [
      { platform: 'twitch', metric: 'followers', label: 'Twitch followers' },
      { platform: 'youtube', metric: 'subscribers', label: 'YouTube subscribers' },
    ],
  },
  {
    id: 'views',
    title: 'Views',
    series: [{ platform: 'youtube', metric: 'views', label: 'YouTube views' }],
  },
  {
    id: 'watch-time',
    title: 'Watch time (minutes per day)',
    series: [{ platform: 'youtube', metric: 'watchTimeMin', label: 'YouTube watch time' }],
  },
]

function isCardPlatform(platform: Platform): platform is CardPlatform {
  return platform in CARD_METRICS
}

function toMetricViews(
  platform: CardPlatform,
  deltas: Readonly<Record<string, MetricDelta>>,
  series: readonly DayMetrics[],
  rangeDays: readonly string[],
): MetricView[] {
  // The annotation is load-bearing: without it TS widens the callback's return
  // to a union of two ARRAY types and `flatMap` then demands both match the
  // first branch, so the `daily` case's `delta: null` fails to assign.
  return CARD_METRICS[platform].flatMap((spec): MetricView[] => {
    const entry = deltas[spec.key]
    // No entry means the range carried no reading for this key — an unlinked
    // sub program, a metric the creator's plan doesn't report. Showing a zero
    // would be a claim the data does not make.
    if (entry === undefined) return []

    const base = {
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      points: toChartPoints(series, platform, spec.key, rangeDays),
    }
    // The delta's own `kind` decides how to read it — no second lookup in
    // METRIC_KINDS, and a future variant is a compile error here.
    switch (entry.kind) {
      case 'point':
        return [{ ...base, value: entry.last, delta: entry.delta }]
      case 'daily':
        return [{ ...base, value: entry.total, delta: null }]
      // A default branch would be unreachable code no test could cover, and it
      // would swallow the compile error that a new variant should raise here.
      // no default
    }
  })
}

/**
 * One card per linked platform the Overview knows how to render, in the order
 * `listPlatformAccounts` returned. Cards are built for every linked account
 * regardless of status: a `reauth_required` account still has real history
 * worth showing, and the reauth banner — not a hidden card — is what tells the
 * creator their link needs attention.
 */
export function toPlatformCards(
  accounts: readonly PlatformAccountSummary[],
  series: readonly DayMetrics[],
  rangeDays: readonly string[],
  liveByPlatform: Partial<Record<Platform, LiveStatus>>,
): PlatformCardData[] {
  // One pass over the series for every card, rather than one per platform.
  const deltas = computeDeltas(series)

  return accounts.flatMap((account) => {
    if (!isCardPlatform(account.platform)) return []
    const platform = account.platform
    return [
      {
        platform,
        title: PLATFORM_LABEL[platform],
        handle: account.handle,
        metrics: toMetricViews(platform, deltas[platform] ?? {}, series, rangeDays),
        live: liveByPlatform[platform] ?? null,
      },
    ]
  })
}

/**
 * The Overview's trend charts, dropping any series whose platform is not linked
 * and any chart left with no series at all — an empty panel for a platform the
 * creator never connected reads as broken rather than as absent.
 */
export function toOverviewCharts(
  series: readonly DayMetrics[],
  platforms: readonly Platform[],
  rangeDays: readonly string[],
): OverviewChart[] {
  return CHART_SPECS.flatMap((spec) => {
    const trendSeries: TrendSeries[] = spec.series
      .filter((entry) => platforms.includes(entry.platform))
      .map((entry) => ({
        id: entry.platform,
        label: entry.label,
        points: toChartPoints(series, entry.platform, entry.metric, rangeDays),
      }))

    if (trendSeries.length === 0) return []
    return [{ id: spec.id, title: spec.title, series: trendSeries }]
  })
}
