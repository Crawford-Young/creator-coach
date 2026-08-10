import { scaleLinear, scaleUtc, type ScaleLinear, type ScaleTime } from 'd3-scale'
import type { RangePreset } from '@/lib/metrics/query'
import type { ChartPoint } from '@/components/ui/chart/segment'

export const TICK_COUNT: Readonly<Record<RangePreset, number>> = {
  '7d': 7,
  '30d': 5,
  '90d': 4,
  all: 4,
}

const FALLBACK_TIME = 0
const FALLBACK_VALUE = 0

/**
 * Builds the shared x/y scales for a chart from its already-segmented
 * points (see `segmentSeries`). The x domain spans the min/max `t` across
 * every segment; the y domain is 0-anchored up to the max `v`, then
 * `.nice()`d to round tick values — matching a count-style metric (a
 * follower/subscriber/view total reads naturally against a zero baseline).
 * An empty `segments` input (no data at all) falls back to a degenerate but
 * finite domain rather than propagating NaN/Infinity from `Math.min`/`Math.max`
 * over an empty array.
 */
export function makeScales(
  segments: readonly (readonly ChartPoint[])[],
  width: number,
  height: number,
): { x: ScaleTime<number, number>; y: ScaleLinear<number, number> } {
  const points = segments.flat()
  const times = points.map((point) => point.t)
  const values = points.map((point) => point.v).filter((v): v is number => v !== null)

  const minTime = times.length > 0 ? Math.min(...times) : FALLBACK_TIME
  const maxTime = times.length > 0 ? Math.max(...times) : FALLBACK_TIME
  const maxValue = values.length > 0 ? Math.max(...values) : FALLBACK_VALUE

  const x = scaleUtc([minTime, maxTime], [0, width])
  const y = scaleLinear([0, maxValue], [height, 0]).nice()

  return { x, y }
}
