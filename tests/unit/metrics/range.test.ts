import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_RANGE,
  parseRange,
  RANGE_PARAM,
  RANGE_PRESETS,
  rangeDayKeys,
  rangeHref,
  rangeStart,
} from '@/lib/metrics/range'

// Fixed instant, mid-afternoon UTC — a range boundary lands at the same
// wall-clock time N days back, so the boundary DAY is partially covered and
// still belongs on the axis.
const NOW = new Date('2026-08-11T13:45:00.000Z')

describe('rangeStart', () => {
  it('returns null for the all-time range, so no capturedAt filter is applied', () => {
    expect(rangeStart('all', NOW)).toBeNull()
  })

  it.each([
    ['7d' as const, '2026-08-04T13:45:00.000Z'],
    ['30d' as const, '2026-07-12T13:45:00.000Z'],
    ['90d' as const, '2026-05-13T13:45:00.000Z'],
  ])('subtracts the preset day count for %s', (range, expected) => {
    expect(rangeStart(range, NOW)?.toISOString()).toBe(expected)
  })
})

describe('parseRange', () => {
  it.each(RANGE_PRESETS)('accepts %s unchanged', (preset) => {
    expect(parseRange(preset)).toBe(preset)
  })

  it.each([
    ['an unknown string', 'yesterday'],
    ['an empty value', ''],
    ['a param the URL never carried', null],
    ['an undefined value', undefined],
  ])('falls back to the default range for %s', (_label, value) => {
    expect(parseRange(value)).toBe(DEFAULT_RANGE)
  })

  // What a repeated param ACTUALLY does here. `URLSearchParams.get` returns the
  // first value, so the choice is made before `parseRange` sees anything — the
  // array form it used to claim to handle cannot reach it from the one caller.
  it('takes the first value of a repeated param, as URLSearchParams.get hands it over', () => {
    const repeated = new URLSearchParams('range=7d&range=30d')

    expect(parseRange(repeated.get(RANGE_PARAM))).toBe('7d')
  })

  it('defaults to 90d per the approved mock', () => {
    expect(DEFAULT_RANGE).toBe('90d')
  })
})

describe('rangeHref', () => {
  // The param name is written once and read by both the picker that sets it and
  // the page that parses it. Two independent string literals would let a rename
  // turn the picker into a no-op that still renders and still highlights.
  it('names the param the page parses', () => {
    expect(RANGE_PARAM).toBe('range')
  })

  it('builds a query-only href, so the current pathname is kept', () => {
    expect(rangeHref('7d')).toBe('?range=7d')
  })

  it('replaces the existing range and keeps every sibling param', () => {
    const current = new URLSearchParams('range=90d&sort=views&page=2')

    expect(rangeHref('7d', current)).toBe('?range=7d&sort=views&page=2')
  })

  it('adds the range to a search string that has none', () => {
    expect(rangeHref('all', new URLSearchParams('sort=views'))).toBe('?sort=views&range=all')
  })

  it('does not mutate the caller’s params', () => {
    const current = new URLSearchParams('range=90d')

    rangeHref('7d', current)

    expect(current.get('range')).toBe('90d')
  })
})

describe('rangeDayKeys', () => {
  // The axis has to agree with queryChannelSeries BY CONSTRUCTION: the query
  // matches capturedAt >= rangeStart, so the boundary day itself carries rows
  // and must have a column. That makes a 7-day range 8 day keys wide.
  it.each([
    ['7d' as const, 8, '2026-08-04'],
    ['30d' as const, 31, '2026-07-12'],
    ['90d' as const, 91, '2026-05-13'],
  ])('spans the %s window inclusive of both boundary days', (range, count, firstDay) => {
    const keys = rangeDayKeys(range, NOW, [])

    expect(keys).toHaveLength(count)
    expect(keys[0]).toBe(firstDay)
    expect(keys.at(-1)).toBe('2026-08-11')
  })

  it('emits ascending YYYY-MM-DD UTC keys with no gaps', () => {
    const keys = rangeDayKeys('7d', NOW, [])

    expect(keys).toEqual([
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
    ])
  })

  it('starts the all-time axis at the earliest day the series actually carries', () => {
    const keys = rangeDayKeys('all', NOW, ['2026-08-10', '2026-08-08', '2026-08-09'])

    expect(keys).toEqual(['2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11'])
  })

  it('yields an empty all-time axis when the series is empty', () => {
    expect(rangeDayKeys('all', NOW, [])).toEqual([])
  })

  it('ignores present days for a bounded preset', () => {
    const keys = rangeDayKeys('7d', NOW, ['2017-01-16'])

    expect(keys[0]).toBe('2026-08-04')
  })
})

describe('range module purity', () => {
  // RangePicker and the dashboard components import range values (not just
  // types), so this module must never reach a module that touches server-only
  // env — a value import of @/lib/metrics/query would drag the mongodb driver
  // into the client bundle and crash the page at runtime. The allowlist is
  // deliberate: adding an entry means proving the new import is env-free.
  const ALLOWED_IMPORTS = ['zod']

  it('imports nothing outside the pure allowlist', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/metrics/range.ts'), 'utf8')
    const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])

    expect(specifiers.length).toBeGreaterThan(0)
    expect(specifiers.filter((specifier) => !ALLOWED_IMPORTS.includes(specifier))).toEqual([])
  })
})
