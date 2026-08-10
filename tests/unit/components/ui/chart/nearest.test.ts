import { describe, expect, it } from 'vitest'
import { nearestPoint } from '@/components/ui/chart/nearest'
import type { ChartPoint } from '@/components/ui/chart/segment'

const DAY_MS = 86400000
const HALF_DAY_MS = DAY_MS / 2

function point(t: number, v: number | null): ChartPoint {
  return { t, v }
}

describe('nearestPoint', () => {
  it('returns null for no segments at all', () => {
    expect(nearestPoint([], DAY_MS)).toBeNull()
  })

  it('returns null when every segment is empty', () => {
    expect(nearestPoint([[], []], DAY_MS)).toBeNull()
  })

  it('returns null when the only points are gaps', () => {
    expect(nearestPoint([[point(0, null), point(DAY_MS, null)]], DAY_MS)).toBeNull()
  })

  it('returns the sole point for any t when there is exactly one', () => {
    const only = point(5 * DAY_MS, 42)

    expect(nearestPoint([[only]], 0)).toBe(only)
    expect(nearestPoint([[only]], 100 * DAY_MS)).toBe(only)
  })

  it('returns an exact hit on the queried time', () => {
    const target = point(2 * DAY_MS, 20)
    const segments = [[point(0, 10), point(DAY_MS, 15), target, point(3 * DAY_MS, 30)]]

    expect(nearestPoint(segments, 2 * DAY_MS)).toBe(target)
  })

  it('picks the later point when t falls nearer to it', () => {
    const earlier = point(0, 10)
    const later = point(DAY_MS, 20)

    expect(nearestPoint([[earlier, later]], DAY_MS - 1)).toBe(later)
  })

  it('picks the earlier point when t falls nearer to it', () => {
    const earlier = point(0, 10)
    const later = point(DAY_MS, 20)

    expect(nearestPoint([[earlier, later]], 1)).toBe(earlier)
  })

  it('clamps to the first point when t is below the range', () => {
    const first = point(3 * DAY_MS, 10)
    const segments = [[first, point(4 * DAY_MS, 20), point(5 * DAY_MS, 30)]]

    expect(nearestPoint(segments, 0)).toBe(first)
  })

  it('clamps to the last point when t is above the range', () => {
    const last = point(5 * DAY_MS, 30)
    const segments = [[point(3 * DAY_MS, 10), point(4 * DAY_MS, 20), last]]

    expect(nearestPoint(segments, 100 * DAY_MS)).toBe(last)
  })

  it('searches across the gap between segments', () => {
    const afterGap = point(4 * DAY_MS, 40)
    const segments = [
      [point(0, 10), point(DAY_MS, 20)],
      [afterGap, point(5 * DAY_MS, 50)],
    ]

    // Falls in the gap, closer to the segment that resumes after it.
    expect(nearestPoint(segments, 4 * DAY_MS - HALF_DAY_MS + 1)).toBe(afterGap)
  })

  it('scales past the first bisection step (binary search, not a scan)', () => {
    const points = Array.from({ length: 64 }, (_, index) => point(index * DAY_MS, index))
    const target = points[41]

    expect(nearestPoint([points], 41 * DAY_MS)).toBe(target)
  })
})
