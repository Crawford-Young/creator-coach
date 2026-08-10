import { describe, expect, it } from 'vitest'
import { makeScales, TICK_COUNT } from '@/components/ui/chart/scales'
import type { ChartPoint } from '@/components/ui/chart/segment'

const DAY_MS = 86400000

describe('TICK_COUNT', () => {
  it('maps each range preset to its tick count', () => {
    expect(TICK_COUNT).toEqual({ '7d': 7, '30d': 5, '90d': 4, all: 4 })
  })
})

describe('makeScales', () => {
  it('x domain spans the min/max t across all segments; range is [0, width]', () => {
    const segments: ChartPoint[][] = [
      [
        { t: 0, v: 10 },
        { t: DAY_MS, v: 20 },
      ],
      [{ t: 2 * DAY_MS, v: 30 }],
    ]

    const { x } = makeScales(segments, 300, 150)

    expect(x.domain().map((d) => d.getTime())).toEqual([0, 2 * DAY_MS])
    expect(x.range()).toEqual([0, 300])
  })

  it('y domain is 0-anchored up to the max value, niced; range is [height, 0]', () => {
    const segments: ChartPoint[][] = [
      [
        { t: 0, v: 40 },
        { t: DAY_MS, v: 100 },
      ],
    ]

    const { y } = makeScales(segments, 300, 150)

    expect(y.domain()).toEqual([0, 100])
    expect(y.range()).toEqual([150, 0])
  })

  it('an empty segments array falls back to a finite, non-NaN domain on both scales', () => {
    const { x, y } = makeScales([], 300, 150)

    expect(Number.isFinite(x.domain()[0]?.getTime())).toBe(true)
    expect(Number.isFinite(x.domain()[1]?.getTime())).toBe(true)
    expect(y.domain().every((value) => Number.isFinite(value))).toBe(true)
    expect(x.range()).toEqual([0, 300])
    expect(y.range()).toEqual([150, 0])
  })

  it('segments containing only a single point still produce a valid (non-degenerate-crash) scale', () => {
    const segments: ChartPoint[][] = [[{ t: 5, v: 7 }]]

    const { x, y } = makeScales(segments, 300, 150)

    expect(x.domain().map((d) => d.getTime())).toEqual([5, 5])
    expect(Number.isFinite(y.domain()[0])).toBe(true)
    expect(Number.isFinite(y.domain()[1])).toBe(true)
  })
})
