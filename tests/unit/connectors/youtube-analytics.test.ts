import { describe, expect, it } from 'vitest'
import { formatDate, toUtcDateOnly } from '@/lib/connectors/youtube-analytics'

// `toUtcDateOnly` is the write-side discriminator `isAnalyticsSnapshot` uses
// to tell an analytics-origin row from a connector-origin one — if it ever
// regressed to LOCAL midnight (getFullYear/getMonth/getDate instead of the
// UTC variants), every other test exercising it derives its own expected
// values from the same function, so the whole suite would shift by the same
// broken offset and stay green. These assertions are pinned against literal
// UTC instants and day strings written by hand, independent of the functions
// under test and of `new Date()` (today), so a local-midnight regression
// fails here even if nothing else catches it.
describe('toUtcDateOnly', () => {
  it('truncates a UTC instant to that day’s UTC midnight', () => {
    expect(toUtcDateOnly(new Date('2026-08-05T23:45:00.000Z'))).toEqual(
      new Date('2026-08-05T00:00:00.000Z'),
    )
  })

  it('uses the UTC calendar day, not the local one, for an instant where they differ', () => {
    // 2026-08-06T00:15:00.000Z is still 2026-08-05 evening in every
    // timezone west of UTC (e.g. America/New_York: 2026-08-05T20:15:00
    // local). A regression to local components would truncate to
    // 2026-08-05; the correct UTC-only truncation is 2026-08-06.
    expect(toUtcDateOnly(new Date('2026-08-06T00:15:00.000Z'))).toEqual(
      new Date('2026-08-06T00:00:00.000Z'),
    )
  })

  it('leaves an instant already at UTC midnight unchanged', () => {
    expect(toUtcDateOnly(new Date('2026-01-01T00:00:00.000Z'))).toEqual(
      new Date('2026-01-01T00:00:00.000Z'),
    )
  })
})

describe('formatDate', () => {
  it('formats a UTC instant as its YYYY-MM-DD UTC day', () => {
    expect(formatDate(new Date('2026-01-05T09:00:00.000Z'))).toBe('2026-01-05')
  })

  it('uses the UTC calendar day, not the local one, for an instant where they differ', () => {
    expect(formatDate(new Date('2026-08-06T00:15:00.000Z'))).toBe('2026-08-06')
  })

  it('does not roll over on an instant just before UTC midnight', () => {
    expect(formatDate(new Date('2026-12-31T23:59:59.999Z'))).toBe('2026-12-31')
  })
})
