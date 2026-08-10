import { describe, expect, it } from 'vitest'
import { segmentSeries, toChartPoints, type ChartPoint } from '@/components/ui/chart/segment'
import type { DayMetrics } from '@/lib/metrics/query'

function point(t: number, v: number | null): ChartPoint {
  return { t, v }
}

describe('segmentSeries', () => {
  it('a series with no nulls is one segment', () => {
    const points = [point(1, 10), point(2, 20), point(3, 30)]
    expect(segmentSeries(points)).toEqual([points])
  })

  it('an interior null splits the series into two segments', () => {
    const points = [point(1, 10), point(2, null), point(3, 30)]
    expect(segmentSeries(points)).toEqual([[point(1, 10)], [point(3, 30)]])
  })

  it('leading and trailing nulls are dropped, not emitted as empty segments', () => {
    const points = [point(1, null), point(2, 10), point(3, 20), point(4, null)]
    expect(segmentSeries(points)).toEqual([[point(2, 10), point(3, 20)]])
  })

  it('an all-null series produces no segments', () => {
    const points = [point(1, null), point(2, null)]
    expect(segmentSeries(points)).toEqual([])
  })

  it('a single non-null point between nulls survives as a one-point segment', () => {
    const points = [point(1, null), point(2, 10), point(3, null)]
    expect(segmentSeries(points)).toEqual([[point(2, 10)]])
  })

  it('an empty series produces no segments', () => {
    expect(segmentSeries([])).toEqual([])
  })
})

describe('toChartPoints', () => {
  const series: DayMetrics[] = [
    { day: '2026-08-01', platform: 'twitch', metrics: { followers: 100 } },
    { day: '2026-08-03', platform: 'twitch', metrics: { followers: 120 } },
    { day: '2026-08-02', platform: 'youtube', metrics: { followers: 999 } },
  ]
  const rangeDays = ['2026-08-01', '2026-08-02', '2026-08-03']

  it('a day present in the series for the requested platform+metric carries its value', () => {
    const points = toChartPoints(series, 'twitch', 'followers', rangeDays)
    expect(points[0]).toEqual({ t: Date.parse('2026-08-01T00:00:00.000Z'), v: 100 })
    expect(points[2]).toEqual({ t: Date.parse('2026-08-03T00:00:00.000Z'), v: 120 })
  })

  it('a day missing from the series (or belonging to another platform) becomes a null gap', () => {
    const points = toChartPoints(series, 'twitch', 'followers', rangeDays)
    expect(points[1]).toEqual({ t: Date.parse('2026-08-02T00:00:00.000Z'), v: null })
  })

  it('produces one ChartPoint per rangeDays entry, in order, regardless of series length', () => {
    const points = toChartPoints(series, 'twitch', 'followers', rangeDays)
    expect(points).toHaveLength(3)
  })

  it('a day whose row exists but lacks the requested metric key also becomes a null gap', () => {
    const partialSeries: DayMetrics[] = [
      { day: '2026-08-01', platform: 'twitch', metrics: { ccv: 42 } },
    ]
    const points = toChartPoints(partialSeries, 'twitch', 'followers', ['2026-08-01'])
    expect(points[0]).toEqual({ t: Date.parse('2026-08-01T00:00:00.000Z'), v: null })
  })

  it('an empty rangeDays produces an empty ChartPoint array', () => {
    expect(toChartPoints(series, 'twitch', 'followers', [])).toEqual([])
  })
})
