import type { Platform } from '@/db'
import type { DayMetrics } from '@/lib/metrics/query'

export type MetricKind = 'point' | 'daily'

// Every metric a card may chart declares its kind here. Keys deliberately
// absent are the ones no kind describes: `ccv` is an instantaneous gauge and
// `avgViewDurationSec` a daily average — summing or subtracting either is
// nonsense, so `computeDeltas` reports nothing for them rather than guessing.
export const METRIC_KINDS = {
  followers: 'point',
  subscribers: 'point',
  views: 'point',
  subPoints: 'point',
  likes: 'point',
  comments: 'point',
  watchTimeMin: 'daily',
  subscribersGained: 'daily',
} as const satisfies Readonly<Record<string, MetricKind>>

/**
 * A metric key this module knows how to classify — and therefore the only kind
 * of key a card may chart. Typing a card's metric keys as `MetricKey` is what
 * makes an unclassified metric a compile error at the card: it would otherwise
 * produce no delta entry, and the whole metric block would vanish from the
 * rendered card with nothing failing.
 */
export type MetricKey = keyof typeof METRIC_KINDS

// The classification read as a lookup: `computeDeltas` receives metric names as
// plain strings off a snapshot document, which is exactly the untrusted-key
// case the literal-keyed type above must NOT accept.
const KIND_BY_KEY: Readonly<Partial<Record<string, MetricKind>>> = METRIC_KINDS

/** A cumulative running total: endpoints and the growth between them. */
export interface PointDelta {
  readonly kind: 'point'
  readonly first: number
  readonly last: number
  readonly delta: number
}

/** A per-day value: the range's sum, with no endpoints worth reporting. */
export interface DailyTotal {
  readonly kind: 'daily'
  readonly total: number
}

/**
 * Discriminated on `kind` so a consumer cannot read a range SUM as if it were
 * growth: the two shapes share no numeric field name, and TypeScript forces
 * the branch. A flat `{first,last,delta}` carrying both meanings made
 * correctness depend on the caller re-consulting `METRIC_KINDS` — an
 * obligation the type never stated, and one a new consumer inherits silently.
 */
export type MetricDelta = PointDelta | DailyTotal

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
 * so they report `{ kind: 'daily', total }`, the SUM across every day the
 * metric appears.
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
      const kind = KIND_BY_KEY[metric]
      if (kind === undefined) {
        continue
      }
      const existing = platformMetrics[metric]
      if (kind === 'daily') {
        const running = existing?.kind === 'daily' ? existing.total : 0
        platformMetrics[metric] = { kind: 'daily', total: running + value }
      } else {
        platformMetrics[metric] =
          existing?.kind === 'point'
            ? { kind: 'point', first: existing.first, last: value, delta: value - existing.first }
            : { kind: 'point', first: value, last: value, delta: 0 }
      }
    }
  }

  return result
}
