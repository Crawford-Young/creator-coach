import { z } from 'zod'

// Pure range vocabulary, deliberately free of any import that reaches server
// env. `@/lib/metrics/query` imports `@/db` (and therefore the mongodb
// driver), so a component that needs a range VALUE — the picker's preset
// list, the default — cannot import it from there without dragging the driver
// into the client bundle. Types are erased and would have been safe; values
// are not. tests/unit/metrics/range.test.ts pins the import allowlist.

export type RangePreset = '7d' | '30d' | '90d' | 'all'

export const RANGE_PRESETS = ['7d', '30d', '90d', 'all'] as const satisfies readonly RangePreset[]

/** Per the approved W2 mock. */
export const DEFAULT_RANGE: RangePreset = '90d'

/**
 * The searchParam the range travels in. Read by the page that parses it and by
 * `rangeHref` that writes it — one literal, so a rename cannot leave a picker
 * that still renders and highlights while setting a param nobody reads.
 */
export const RANGE_PARAM = 'range'

const MS_PER_DAY = 86400000
const DAY_KEY_LENGTH = 10 // 'YYYY-MM-DD'

const RANGE_DAYS: Record<Exclude<RangePreset, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

const rangeSchema = z.enum(RANGE_PRESETS)

/**
 * Narrows an untrusted `?range=` searchParam, in the shape `URLSearchParams`
 * hands it over: the param's first value, or `null` when it is absent.
 * Anything the enum rejects — absent or misspelled — reads as "no opinion" and
 * gets the default rather than an error page.
 *
 * A repeated `?range=7d&range=30d` is FIRST-WINS ('7d'), not a fallback to the
 * default: `URLSearchParams.get` has already chosen before this sees anything,
 * so the array form a raw searchParams object can produce never reaches here.
 */
export function parseRange(value: string | null | undefined): RangePreset {
  const parsed = rangeSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_RANGE
}

/**
 * A query-only href selecting `preset`, keeping the current pathname. Sibling
 * params in `current` survive — a bare `?range=x` would drop a sort or a page
 * cursor the moment any surface carried one. The caller's params are copied,
 * never mutated.
 */
export function rangeHref(preset: RangePreset, current?: URLSearchParams): string {
  const next = new URLSearchParams(current)
  next.set(RANGE_PARAM, preset)
  return `?${next.toString()}`
}

/** Inclusive lower bound for a range's `capturedAt` filter; null = unbounded. */
export function rangeStart(range: RangePreset, now: Date): Date | null {
  if (range === 'all') return null
  return new Date(now.getTime() - RANGE_DAYS[range] * MS_PER_DAY)
}

function toDayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, DAY_KEY_LENGTH)
}

function utcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function axisStart(range: RangePreset, now: Date, presentDays: readonly string[]): number | null {
  const bounded = rangeStart(range, now)
  if (bounded !== null) return utcMidnight(bounded)
  // 'all' has no arithmetic boundary — the data is the boundary. Day keys sort
  // lexicographically because they are zero-padded ISO dates.
  if (presentDays.length === 0) return null
  return Date.parse(`${[...presentDays].sort()[0]}T00:00:00.000Z`)
}

/**
 * The full day axis a chart draws, ascending, one key per UTC day with no
 * gaps — `toChartPoints` turns a day the series never mentions into a null
 * point rather than dropping it.
 *
 * Derived from `rangeStart`, the same function `queryChannelSeries` filters
 * with — but sharing the arithmetic is not enough on its own, because two
 * clock reads a few awaits apart can straddle a UTC midnight and yield a
 * window and an axis that disagree by a day. Agreement comes from the CALLER
 * passing one `now` to both. The query matches `capturedAt >= now - N days`,
 * which means the boundary day itself carries rows (from that clock time
 * onward) and earns a column: a '7d' axis is 8 days wide, '30d' is 31, '90d'
 * is 91.
 *
 * `presentDays` is consulted only for 'all', where the earliest day the series
 * actually carries is the start; an empty series there yields an empty axis.
 */
export function rangeDayKeys(
  range: RangePreset,
  now: Date,
  presentDays: readonly string[],
): string[] {
  const start = axisStart(range, now, presentDays)
  if (start === null) return []

  const end = utcMidnight(now)
  const keys: string[] = []
  for (let day = start; day <= end; day += MS_PER_DAY) {
    keys.push(toDayKey(day))
  }
  return keys
}
