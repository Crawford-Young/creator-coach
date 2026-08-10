import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Sparkline } from '@/components/ui/chart/sparkline'
import type { ChartPoint } from '@/components/ui/chart/segment'

const DAY_MS = 86400000

function point(t: number, v: number | null): ChartPoint {
  return { t, v }
}

describe('Sparkline', () => {
  it('renders one <path> per segment, each with a non-empty d attribute', () => {
    const points = [
      point(0, 10),
      point(DAY_MS, 20),
      point(2 * DAY_MS, null),
      point(3 * DAY_MS, 30),
      point(4 * DAY_MS, 40),
    ]
    const { container } = render(<Sparkline points={points} color="red" />)

    const paths = container.querySelectorAll('path')
    expect(paths).toHaveLength(2)
    paths.forEach((path) => {
      expect(path.getAttribute('d')).toBeTruthy()
    })
  })

  it('geometry attrs are numeric/%, never calc()', () => {
    const points = [point(0, 10), point(DAY_MS, 20), point(2 * DAY_MS, 30)]
    const { container } = render(<Sparkline points={points} color="red" width={80} height={24} />)

    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/)

    const path = container.querySelector('path')
    expect(path?.getAttribute('d')).not.toContain('calc(')

    for (const attr of ['width', 'height']) {
      // style-driven sizing must never be a calc() expression
      expect(svg?.style.getPropertyValue(attr)).not.toContain('calc(')
    }
  })

  it('sets aria-hidden on the svg', () => {
    const points = [point(0, 10), point(DAY_MS, 20)]
    const { container } = render(<Sparkline points={points} color="red" />)

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('empty points render an empty-state placeholder — no path, no crash', () => {
    const { container } = render(<Sparkline points={[]} color="red" width={80} height={24} />)

    expect(container.querySelector('path')).toBeNull()

    const placeholder = container.querySelector('line')
    expect(placeholder).toBeTruthy()
    expect(placeholder?.getAttribute('stroke-dasharray')).toBe('2,2')
    expect(Number(placeholder?.getAttribute('y1'))).toBe(12)
    expect(Number(placeholder?.getAttribute('y2'))).toBe(12)
  })

  it('a single-point segment renders a <circle> with numeric cx/cy', () => {
    const points = [point(0, null), point(DAY_MS, 10), point(2 * DAY_MS, null)]
    const { container } = render(<Sparkline points={points} color="red" />)

    const circle = container.querySelector('circle')
    expect(circle).toBeTruthy()
    expect(Number.isFinite(Number(circle?.getAttribute('cx')))).toBe(true)
    expect(Number.isFinite(Number(circle?.getAttribute('cy')))).toBe(true)
    expect(container.querySelector('path')).toBeNull()
  })
})
