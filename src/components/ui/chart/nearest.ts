import type { ChartPoint } from '@/components/ui/chart/segment'

/**
 * Finds the charted point closest in time to `t`, searching every segment as
 * one flattened series. Assumes the segments are in ascending time order —
 * which `segmentSeries` guarantees, since it preserves the day-axis order it
 * is given. Gap points (`v: null`) are never candidates, so a hover landing
 * inside a gap snaps to whichever real reading borders it more closely.
 *
 * Returns `null` only when there is no real reading anywhere in the input.
 * A `t` outside the series' span clamps to the first or last point rather
 * than reporting nothing.
 */
export function nearestPoint(
  segments: readonly (readonly ChartPoint[])[],
  t: number,
): ChartPoint | null {
  const points = segments.flat().filter((point) => point.v !== null)
  if (points.length === 0) return null

  let low = 0
  let high = points.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (points[mid].t < t) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  // `low` is now the first point at or after `t`, or the last point when `t`
  // runs past the end. Only its predecessor can beat it on distance.
  const candidate = points[low]
  if (low === 0) return candidate

  const previous = points[low - 1]
  return t - previous.t < candidate.t - t ? previous : candidate
}
