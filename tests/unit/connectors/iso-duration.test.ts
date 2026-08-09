import { describe, expect, it } from 'vitest'
import { IsoDurationParseError, parseIsoDuration } from '@/lib/connectors/iso-duration'

describe('parseIsoDuration', () => {
  const validCases: Array<[string, number]> = [
    ['PT4M13S', 253],
    ['PT1H2M3S', 3723],
    ['PT45S', 45],
    ['P1DT2H', 93600],
    ['PT0S', 0],
  ]

  it.each(validCases)('parses %s to %i seconds', (input, expected) => {
    expect(parseIsoDuration(input)).toBe(expected)
  })

  const invalidCases = ['', 'P', 'PT', 'not-a-duration', 'PT1S2H', '4M13S', 'PT-4M']

  it.each(invalidCases)('throws IsoDurationParseError for invalid input %j', (input) => {
    expect(() => parseIsoDuration(input)).toThrow(IsoDurationParseError)
  })
})
