import type { Platform } from '@/db'
import type { DayMetrics } from '@/lib/metrics/query'

export interface ChartPoint {
  readonly t: number // epoch ms, UTC midnight of day
  readonly v: number | null // null = gap
}

// Verbatim per plan.
export function segmentSeries(points: readonly ChartPoint[]): ChartPoint[][] {
  const segments: ChartPoint[][] = []
  let current: ChartPoint[] = []
  for (const point of points) {
    if (point.v === null) {
      if (current.length > 0) segments.push(current)
      current = []
    } else {
      current.push(point)
    }
  }
  if (current.length > 0) segments.push(current)
  return segments
}

function dayToEpochMs(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getTime()
}

/**
 * Projects a day-scoped metric series onto a full day axis. `rangeDays` is
 * the complete, ordered set of days a chart is drawing (including days with
 * no snapshot) — a day with no matching row, or a row missing the requested
 * metric key, becomes a `v: null` gap rather than being omitted, so the
 * output always has exactly `rangeDays.length` points in the same order.
 */
export function toChartPoints(
  series: readonly DayMetrics[],
  platform: Platform,
  metric: string,
  rangeDays: readonly string[],
): ChartPoint[] {
  const valueByDay = new Map(
    series
      .filter((dayMetrics) => dayMetrics.platform === platform)
      .map((dayMetrics) => [dayMetrics.day, dayMetrics.metrics[metric]] as const),
  )

  return rangeDays.map((day) => {
    const value = valueByDay.get(day)
    return { t: dayToEpochMs(day), v: value === undefined ? null : value }
  })
}
