import { describe, expect, it } from 'vitest'
import { computeDeltas, METRIC_KINDS } from '@/lib/metrics/deltas'
import type { DayMetrics } from '@/lib/metrics/query'

describe('METRIC_KINDS', () => {
  it('classifies point vs daily metrics per spec', () => {
    expect(METRIC_KINDS.followers).toBe('point')
    expect(METRIC_KINDS.subscribers).toBe('point')
    expect(METRIC_KINDS.views).toBe('point')
    expect(METRIC_KINDS.subPoints).toBe('point')
    expect(METRIC_KINDS.watchTimeMin).toBe('daily')
    expect(METRIC_KINDS.subscribersGained).toBe('daily')
  })
})

describe('computeDeltas', () => {
  it('point metric: delta is last minus first across the series, including negative deltas', () => {
    const series: DayMetrics[] = [
      { day: '2026-08-01', platform: 'twitch', metrics: { followers: 100 } },
      { day: '2026-08-02', platform: 'twitch', metrics: { followers: 110 } },
      { day: '2026-08-03', platform: 'twitch', metrics: { followers: 90 } },
    ]

    const deltas = computeDeltas(series)

    expect(deltas.twitch?.followers).toEqual({ first: 100, last: 90, delta: -10 })
  })

  it('daily metric: delta is the sum over the range, first/last 0-anchored', () => {
    const series: DayMetrics[] = [
      { day: '2026-08-01', platform: 'youtube', metrics: { watchTimeMin: 100 } },
      { day: '2026-08-02', platform: 'youtube', metrics: { watchTimeMin: 150 } },
      { day: '2026-08-03', platform: 'youtube', metrics: { watchTimeMin: 200 } },
    ]

    const deltas = computeDeltas(series)

    expect(deltas.youtube?.watchTimeMin).toEqual({ first: 0, last: 0, delta: 450 })
  })

  it('metric present only one day: point kind delta is 0', () => {
    const series: DayMetrics[] = [
      { day: '2026-08-01', platform: 'twitch', metrics: { subscribers: 42 } },
    ]

    const deltas = computeDeltas(series)

    expect(deltas.twitch?.subscribers).toEqual({ first: 42, last: 42, delta: 0 })
  })

  it('tracks multiple platforms and metrics independently within one series', () => {
    const series: DayMetrics[] = [
      { day: '2026-08-01', platform: 'twitch', metrics: { followers: 10, subPoints: 5 } },
      { day: '2026-08-01', platform: 'youtube', metrics: { subscribers: 200 } },
      { day: '2026-08-02', platform: 'twitch', metrics: { followers: 12 } },
      { day: '2026-08-02', platform: 'youtube', metrics: { subscribers: 210 } },
    ]

    const deltas = computeDeltas(series)

    expect(deltas.twitch?.followers).toEqual({ first: 10, last: 12, delta: 2 })
    expect(deltas.twitch?.subPoints).toEqual({ first: 5, last: 5, delta: 0 })
    expect(deltas.youtube?.subscribers).toEqual({ first: 200, last: 210, delta: 10 })
  })

  it('empty series returns an empty object', () => {
    expect(computeDeltas([])).toEqual({})
  })
})
