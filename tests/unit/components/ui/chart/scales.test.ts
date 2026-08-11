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
  it("'extent' spans the min/max t across all segments; range is [0, width]", () => {
    const segments: ChartPoint[][] = [
      [
        { t: 0, v: 10 },
        { t: DAY_MS, v: 20 },
      ],
      [{ t: 2 * DAY_MS, v: 30 }],
    ]

    const { x } = makeScales(segments, 300, 150, 'extent')

    expect(x.domain().map((d) => d.getTime())).toEqual([0, 2 * DAY_MS])
    expect(x.range()).toEqual([0, 300])
  })

  // The extent rule is right for a sparkline and wrong for a dated chart: a
  // caller drawing a fixed day window has to be able to say so, or the window
  // it asked for collapses onto whatever days happened to carry a reading.
  it('honours an explicit x domain, so a caller can span days its points never reached', () => {
    const segments: ChartPoint[][] = [
      [
        { t: 5 * DAY_MS, v: 10 },
        { t: 6 * DAY_MS, v: 20 },
      ],
    ]

    const { x } = makeScales(segments, 300, 150, [0, 6 * DAY_MS])

    expect(x.domain().map((d) => d.getTime())).toEqual([0, 6 * DAY_MS])
    expect(x.range()).toEqual([0, 300])
  })

  it('y domain is the data extent [min, max] across all values, niced; range is [height, 0]', () => {
    const segments: ChartPoint[][] = [
      [
        { t: 0, v: 40 },
        { t: DAY_MS, v: 100 },
      ],
    ]

    const { y } = makeScales(segments, 300, 150, 'extent')

    expect(y.domain()).toEqual([40, 100])
    expect(y.range()).toEqual([150, 0])
  })

  it('a large-base/small-delta series (P-6: followers 12000->12080) renders at full extent, not 0-anchored', () => {
    const segments: ChartPoint[][] = [
      [
        { t: 0, v: 12000 },
        { t: DAY_MS, v: 12080 },
      ],
    ]

    const { y } = makeScales(segments, 300, 212, 'extent')

    expect(y.domain()).toEqual([12000, 12080])
    // At [0, max] the same data would compress to a ~1px sliver; at data
    // extent the trend consumes the whole plot height.
    expect(y(12000)).toBe(212)
    expect(y(12080)).toBe(0)
  })

  it('an empty segments array falls back to a finite, non-NaN domain on both scales', () => {
    const { x, y } = makeScales([], 300, 150, 'extent')

    expect(Number.isFinite(x.domain()[0]?.getTime())).toBe(true)
    expect(Number.isFinite(x.domain()[1]?.getTime())).toBe(true)
    expect(y.domain().every((value) => Number.isFinite(value))).toBe(true)
    expect(x.range()).toEqual([0, 300])
    expect(y.range()).toEqual([150, 0])
  })

  it('a single-point segment pads the y-domain so the point sits mid-height, not on a zero-height domain', () => {
    const segments: ChartPoint[][] = [[{ t: 5, v: 7 }]]

    const { x, y } = makeScales(segments, 300, 150, 'extent')

    expect(x.domain().map((d) => d.getTime())).toEqual([5, 5])
    expect(y.domain()).toEqual([6, 8])
    expect(y.domain()[1]).toBeGreaterThan(y.domain()[0])
  })

  it('a flat non-zero series (all values equal) pads around the value instead of collapsing to zero height', () => {
    const segments: ChartPoint[][] = [
      [
        { t: 0, v: 50 },
        { t: DAY_MS, v: 50 },
        { t: 2 * DAY_MS, v: 50 },
      ],
    ]

    const { y } = makeScales(segments, 300, 150, 'extent')

    expect(y.domain()).toEqual([47.5, 52.5])
    expect(y.domain()[1]).toBeGreaterThan(y.domain()[0])
  })

  it('an all-zero series pads around zero instead of producing a zero-height domain', () => {
    const segments: ChartPoint[][] = [
      [
        { t: 0, v: 0 },
        { t: DAY_MS, v: 0 },
      ],
    ]

    const { y } = makeScales(segments, 300, 150, 'extent')

    expect(y.domain()).toEqual([-1, 1])
    expect(y.domain()[1]).toBeGreaterThan(y.domain()[0])
  })
})
