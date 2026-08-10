import type { Platform } from '@/db'
import type { DayMetrics } from '@/lib/metrics/query'

export type MetricKind = 'point' | 'daily'

// Every metric a card may chart declares its kind here. Keys deliberately
// absent are the ones no kind describes: `ccv` is an instantaneous gauge and
// `avgViewDurationSec` a daily average — summing or subtracting either is
// nonsense, so `computeDeltas` reports nothing for them rather than guessing.
export const METRIC_KINDS: Readonly<Partial<Record<string, MetricKind>>> = {
  followers: 'point',
  subscribers: 'point',
  views: 'point',
  subPoints: 'point',
  likes: 'point',
  comments: 'point',
  watchTimeMin: 'daily',
  subscribersGained: 'daily',
}

export interface MetricDelta {
  readonly first: number
  readonly last: number
  readonly delta: number
}

/**
 * Computes per-platform, per-metric deltas over a day-ascending series
 * (the order `queryChannelSeries`/`queryItemSeries` already return — this
 * function trusts that order and does no sorting of its own).
 *
 * Point metrics (classified `'point'` in `METRIC_KINDS`, e.g.
 * followers/subscribers/views/subPoints) are cumulative totals: `delta` is
 * the last value minus the first value seen for that metric, and `first`/
 * `last` are the actual endpoint values. A metric seen on only one day has
 * `first === last` and `delta === 0`.
 *
 * Daily metrics (watchTimeMin/subscribersGained) are per-day values, not
 * running totals — a first-minus-last delta would be meaningless for them,
 * so `delta` is instead the SUM across every day the metric appears, and
 * `first`/`last` are both 0-anchored (there is no single first/last
 * day-value pair worth reporting for a summed range).
 *
 * A key absent from `METRIC_KINDS` yields NO entry at all — a platform whose
 * series carries only unclassified keys still appears, mapped to an empty
 * record. Classifying a metric is how it opts in to a delta.
 */
export function computeDeltas(
  series: readonly DayMetrics[],
): Partial<Record<Platform, Record<string, MetricDelta>>> {
  const result: Partial<Record<Platform, Record<string, MetricDelta>>> = {}

  for (const point of series) {
    const platformMetrics = (result[point.platform] ??= {})
    for (const [metric, value] of Object.entries(point.metrics)) {
      const kind = METRIC_KINDS[metric]
      if (kind === undefined) {
        continue
      }
      const existing = platformMetrics[metric]
      if (kind === 'daily') {
        platformMetrics[metric] = existing
          ? { first: 0, last: 0, delta: existing.delta + value }
          : { first: 0, last: 0, delta: value }
      } else {
        platformMetrics[metric] = existing
          ? { first: existing.first, last: value, delta: value - existing.first }
          : { first: value, last: value, delta: 0 }
      }
    }
  }

  return result
}
