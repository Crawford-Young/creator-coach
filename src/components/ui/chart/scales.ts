import { scaleLinear, scaleUtc, type ScaleLinear, type ScaleTime } from 'd3-scale'
import type { RangePreset } from '@/lib/metrics/range'
import type { ChartPoint } from '@/components/ui/chart/segment'

export const TICK_COUNT: Readonly<Record<RangePreset, number>> = {
  '7d': 7,
  '30d': 5,
  '90d': 4,
  all: 4,
}

const FALLBACK_TIME = 0
const FALLBACK_VALUE = 0

// P-6: a 0-anchored y-domain compresses a large-base/small-delta series (a
// follower count moving 12000->12080) to a near-invisible sliver of the plot
// height. The domain is the data extent [min, max] instead, so any trend
// consumes the full available height regardless of its base value.
const FLAT_PAD_RATIO = 0.05
const FLAT_PAD_MIN = 1

/**
 * A degenerate [v, v] extent (a single point, or every value in the series
 * equal) has zero height and can't be `.nice()`d into a usable domain — pad
 * it symmetrically around the value so the plotted point/line sits mid-height
 * instead of collapsing onto one edge. Pad is proportional to the value's
 * magnitude (5%) with a floor of 1, so an all-zero series still pads to a
 * non-zero domain (`FLAT_PAD_MIN` alone covers `v === 0`).
 */
function padFlatExtent(value: number): [number, number] {
  const pad = Math.max(FLAT_PAD_MIN, Math.abs(value) * FLAT_PAD_RATIO)
  return [value - pad, value + pad]
}

/**
 * Builds the shared x/y scales for a chart from its already-segmented
 * points (see `segmentSeries`). The y domain is the data extent `[min, max]`
 * across every value, then `.nice()`d to round tick values. An empty
 * `segments` input (no data at all) falls back to a degenerate but finite
 * domain rather than propagating NaN/Infinity from `Math.min`/`Math.max` over
 * an empty array.
 *
 * The x domain is REQUIRED and has no default, because the two callers want
 * opposite things and a silent default hands the next caller whichever one it
 * did not want:
 *
 * - an explicit `[start, end]` pins the axis to a window the data need not
 *   fill. A dated chart needs this: `segments` carry only the non-null points,
 *   so a range whose readings start late would otherwise crop to them and draw
 *   every range preset identically.
 * - `'extent'` fits the axis to the data (min/max `t` across every segment).
 *   A sparkline wants this: no axis, no labels, no range semantics, so empty
 *   leading days would only cost it width.
 */
export function makeScales(
  segments: readonly (readonly ChartPoint[])[],
  width: number,
  height: number,
  xDomain: readonly [number, number] | 'extent',
): { x: ScaleTime<number, number>; y: ScaleLinear<number, number> } {
  const points = segments.flat()
  const times = points.map((point) => point.t)
  const values = points.map((point) => point.v).filter((v): v is number => v !== null)

  const minTime = times.length > 0 ? Math.min(...times) : FALLBACK_TIME
  const maxTime = times.length > 0 ? Math.max(...times) : FALLBACK_TIME
  const minValue = values.length > 0 ? Math.min(...values) : FALLBACK_VALUE
  const maxValue = values.length > 0 ? Math.max(...values) : FALLBACK_VALUE

  const x = scaleUtc(xDomain === 'extent' ? [minTime, maxTime] : xDomain, [0, width])
  const yDomain =
    values.length > 0 && minValue === maxValue ? padFlatExtent(minValue) : [minValue, maxValue]
  const y = scaleLinear(yDomain, [height, 0]).nice()

  return { x, y }
}
