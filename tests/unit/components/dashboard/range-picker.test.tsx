import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RangePicker } from '@/components/dashboard/range-picker'

describe('RangePicker', () => {
  it('offers every preset as a link that only changes the range param', () => {
    render(<RangePicker active="90d" />)

    expect(screen.getByRole('link', { name: '7 days' })).toHaveAttribute('href', '?range=7d')
    expect(screen.getByRole('link', { name: '30 days' })).toHaveAttribute('href', '?range=30d')
    expect(screen.getByRole('link', { name: '90 days' })).toHaveAttribute('href', '?range=90d')
    expect(screen.getByRole('link', { name: 'All time' })).toHaveAttribute('href', '?range=all')
  })

  // The URL is the only state: no click handler, no useState, so a range change
  // is a server round trip that refetches the series.
  it('marks the active preset and nothing else', () => {
    render(<RangePicker active="30d" />)

    expect(screen.getByRole('link', { name: '30 days' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '90 days' })).not.toHaveAttribute('aria-current')
  })

  it('marks the all-time preset when it is active', () => {
    render(<RangePicker active="all" />)

    expect(screen.getByRole('link', { name: 'All time' })).toHaveAttribute('aria-current', 'page')
  })

  // Switching range must not drop whatever else the URL was carrying — a sort,
  // a page cursor. The picker builds its hrefs from the params it was given.
  it('keeps sibling params when it rewrites the range', () => {
    render(<RangePicker active="90d" params={new URLSearchParams('range=90d&sort=views')} />)

    expect(screen.getByRole('link', { name: '7 days' })).toHaveAttribute(
      'href',
      '?range=7d&sort=views',
    )
  })

  it('groups the presets in a labelled navigation region', () => {
    render(<RangePicker active="7d" />)

    expect(screen.getByRole('navigation', { name: /date range/i })).toBeInTheDocument()
  })
})
