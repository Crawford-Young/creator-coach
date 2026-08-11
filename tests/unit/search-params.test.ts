import { describe, expect, it } from 'vitest'
import { toSearchParams } from '@/lib/search-params'

describe('toSearchParams', () => {
  it('carries a single-valued param through', () => {
    expect(toSearchParams({ range: '7d' }).get('range')).toBe('7d')
  })

  it('keeps every value of a repeated param, in order', () => {
    const params = toSearchParams({ range: ['7d', '30d'] })

    expect(params.getAll('range')).toEqual(['7d', '30d'])
  })

  it('drops absent params rather than writing an empty value', () => {
    const params = toSearchParams({ range: undefined, sort: 'views' })

    expect(params.has('range')).toBe(false)
    expect(params.toString()).toBe('sort=views')
  })

  it('yields an empty search string for an empty record', () => {
    expect(toSearchParams({}).toString()).toBe('')
  })
})
