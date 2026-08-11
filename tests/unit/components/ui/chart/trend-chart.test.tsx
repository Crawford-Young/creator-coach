import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { TrendChart, type TrendSeries } from '@/components/ui/chart/trend-chart'
import { SERIES_COLOR } from '@/components/ui/chart/series-color'
import type { ChartPoint } from '@/components/ui/chart/segment'

const DAY_MS = 86400000

// The stubbed pointer rect is exactly the viewBox width, so a clientX in the
// test reads as a viewBox unit with no scaling arithmetic.
const RECT_WIDTH = 640
const RECT_LEFT = 0
const MARGIN_LEFT = 56
const PLOT_WIDTH = 568
const LAST_DAY_INDEX = 6

function day(index: number): number {
  return index * DAY_MS
}

function series(
  id: TrendSeries['id'],
  label: string,
  values: readonly (number | null)[],
): TrendSeries {
  const points: ChartPoint[] = values.map((v, index) => ({ t: day(index), v }))
  return { id, label, points }
}

// twitch has a gap on day 2 (two segments); youtube is unbroken (one segment).
const TWITCH = series('twitch', 'Twitch followers', [100, 110, null, 130, 140, 150, 160])
const YOUTUBE = series('youtube', 'YouTube subscribers', [50, 55, 60, 65, 70, 75, 80])

function renderChart(props: Partial<React.ComponentProps<typeof TrendChart>> = {}) {
  return render(
    <TrendChart title="Audience growth" series={[TWITCH, YOUTUBE]} range="7d" {...props} />,
  )
}

function getSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector('svg')
  if (svg === null) throw new Error('expected an svg to be rendered')
  return svg
}

/**
 * happy-dom reports an all-zero getBoundingClientRect (so does a real browser
 * before layout), which the component treats as "not measurable yet". Giving
 * the svg a real rect is what lets a pointer test exercise the hover path.
 */
function giveSvgASize(svg: SVGSVGElement): void {
  svg.getBoundingClientRect = (): DOMRect =>
    ({
      x: RECT_LEFT,
      y: 0,
      left: RECT_LEFT,
      top: 0,
      right: RECT_LEFT + RECT_WIDTH,
      bottom: 200,
      width: RECT_WIDTH,
      height: 200,
      toJSON: () => ({}),
    }) as DOMRect
}

// clientX that lands on a given day of a 7-point series.
function clientXForDay(index: number): number {
  return MARGIN_LEFT + (PLOT_WIDTH * index) / LAST_DAY_INDEX
}

function hoverDay(svg: SVGSVGElement, index: number): void {
  giveSvgASize(svg)
  fireEvent.pointerMove(svg, { clientX: clientXForDay(index), clientY: 100 })
}

describe('TrendChart', () => {
  describe('geometry', () => {
    it('renders one <path> per segment across all series, never bridging a gap', () => {
      const { container } = renderChart()

      // twitch: 2 segments (day-2 gap) + youtube: 1 segment.
      const paths = container.querySelectorAll('path')
      expect(paths).toHaveLength(3)
      paths.forEach((path) => {
        expect(path.getAttribute('d')).toBeTruthy()
      })
    })

    it('emits no NaN and no calc() in any geometry attribute', () => {
      const { container } = renderChart()

      const geometryAttrs = ['d', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'x', 'y', 'viewBox']
      container.querySelectorAll('svg, svg *').forEach((element) => {
        geometryAttrs.forEach((name) => {
          const value = element.getAttribute(name)
          if (value === null) return
          expect(value).not.toContain('calc(')
          expect(value).not.toContain('NaN')
        })
      })
    })

    it('strokes each series with its own token colour', () => {
      const { container } = renderChart()

      const strokes = [...container.querySelectorAll('path')].map((path) =>
        path.getAttribute('stroke'),
      )
      expect(strokes).toContain(SERIES_COLOR.twitch)
      expect(strokes).toContain(SERIES_COLOR.youtube)
    })

    it('draws a lone reading between two gaps as a round-capped dot', () => {
      const lonely = series('twitch', 'Twitch followers', [null, null, 120, null, null, null, null])
      const { container } = renderChart({ series: [lonely] })

      const path = container.querySelector('path')
      expect(path?.getAttribute('stroke-linecap')).toBe('round')
      expect(path?.getAttribute('d')).toBeTruthy()
    })

    it('keeps coordinates finite when every reading is identical', () => {
      // A dead-flat series gives makeScales a zero-height value extent; the
      // scale must still resolve to real numbers rather than NaN coordinates.
      const flat = series('twitch', 'Twitch followers', [5000, 5000, 5000, 5000])
      const { container } = renderChart({ series: [flat] })

      const d = container.querySelector('path')?.getAttribute('d') ?? ''
      expect(d).toBeTruthy()
      expect(d).not.toContain('NaN')

      const coordinates = [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)]
      expect(coordinates.length).toBeGreaterThan(0)
      coordinates.forEach((match) => {
        expect(Number.isFinite(Number(match[1]))).toBe(true)
        expect(Number.isFinite(Number(match[2]))).toBe(true)
      })
    })
  })

  describe('axes', () => {
    it('keeps axis furniture recessive and never paints text with a series colour', () => {
      const { container } = renderChart()

      const seriesColours: string[] = [SERIES_COLOR.twitch, SERIES_COLOR.youtube]
      container.querySelectorAll('text').forEach((label) => {
        expect(seriesColours).not.toContain(label.getAttribute('fill'))
      })

      const gridlines = container.querySelectorAll('[data-axis="y"] line')
      expect(gridlines.length).toBeGreaterThan(0)
      gridlines.forEach((gridline) => {
        expect(gridline.getAttribute('stroke')).toBe('var(--border)')
      })
    })

    // The failure this guards: a creator who linked two days into a 90-day
    // window gets an x axis spanning only those two days, so every range preset
    // draws a pixel-identical chart and the picker looks broken. The sr-only
    // table lists all the days, so the two renderings would disagree too.
    it('spans the whole day axis it was given, not just the days carrying a reading', () => {
      const sparse = series('twitch', 'Twitch followers', [null, null, null, null, null, 150, 160])
      const { container } = renderChart({ series: [sparse] })

      const labels = [...container.querySelectorAll('[data-axis="x"] text')].map(
        (node) => node.textContent,
      )
      expect(labels[0]).toBe('Jan 1')
      expect(labels.at(-1)).toBe('Jan 7')
    })

    it('takes its x tick density from the range preset', () => {
      const dense = renderChart({ range: '7d' })
      const denseTicks = dense.container.querySelectorAll('[data-axis="x"] text').length
      dense.unmount()

      const sparse = renderChart({ range: 'all' })
      const sparseTicks = sparse.container.querySelectorAll('[data-axis="x"] text').length

      expect(denseTicks).toBeGreaterThan(sparseTicks)
    })
  })

  describe('legend', () => {
    it('shows a swatch and label per series when there are two or more', () => {
      renderChart()

      const legend = screen.getByRole('list', { name: /series/i })
      const items = within(legend).getAllByRole('listitem')
      expect(items).toHaveLength(2)
      expect(items[0]).toHaveTextContent('Twitch followers')
      expect(items[1]).toHaveTextContent('YouTube subscribers')
    })

    it('omits the legend for a single series', () => {
      renderChart({ series: [TWITCH] })

      expect(screen.queryByRole('list', { name: /series/i })).toBeNull()
    })
  })

  describe('accessibility', () => {
    it('hides the svg and exposes the data as a table instead', () => {
      const { container } = renderChart()

      expect(getSvg(container).getAttribute('aria-hidden')).toBe('true')

      const table = screen.getByRole('table')
      expect(within(table).getByText('Audience growth')).toBeTruthy()
    })

    it('gives the table a row per day with each series value', () => {
      renderChart()

      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      // 7 day rows + the header row.
      expect(rows).toHaveLength(8)

      const headerCells = within(rows[0]).getAllByRole('columnheader')
      expect(headerCells.map((cell) => cell.textContent)).toEqual([
        'Day',
        'Twitch followers',
        'YouTube subscribers',
      ])

      const firstDay = within(rows[1]).getAllByRole('cell')
      expect(firstDay.map((cell) => cell.textContent)).toEqual(['100', '50'])
    })

    it('marks a gap day as missing rather than inventing a value', () => {
      renderChart()

      const rows = within(screen.getByRole('table')).getAllByRole('row')
      const gapDay = within(rows[3]).getAllByRole('cell')
      expect(gapDay.map((cell) => cell.textContent)).toEqual(['—', '60'])
    })

    it('marks a day a series does not cover at all as missing', () => {
      const shortYoutube = series('youtube', 'YouTube subscribers', [50, 55, 60, 65])
      renderChart({ series: [TWITCH, shortYoutube] })

      const rows = within(screen.getByRole('table')).getAllByRole('row')
      const lastDay = within(rows[rows.length - 1]).getAllByRole('cell')
      expect(lastDay.map((cell) => cell.textContent)).toEqual(['160', '—'])
    })

    it('renders the title as a heading', () => {
      renderChart()

      expect(screen.getByRole('heading', { name: 'Audience growth' })).toBeTruthy()
    })
  })

  describe('hover tooltip', () => {
    it('shows no tooltip until the pointer moves over the plot', () => {
      const { container } = renderChart()

      expect(container.querySelector('[data-testid="trend-tooltip"]')).toBeNull()
    })

    it('reports every series reading on the nearest day', () => {
      const { container } = renderChart()

      hoverDay(getSvg(container), 3)

      const tooltip = container.querySelector('[data-testid="trend-tooltip"]')
      expect(tooltip).toBeTruthy()
      expect(tooltip?.textContent).toContain('130')
      expect(tooltip?.textContent).toContain('65')
    })

    it('omits a series that has a gap on the hovered day', () => {
      const { container } = renderChart()

      hoverDay(getSvg(container), 2)

      const tooltip = container.querySelector('[data-testid="trend-tooltip"]')
      expect(tooltip?.textContent).toContain('60')
      expect(tooltip?.textContent).not.toContain('Twitch followers')
    })

    it('draws a crosshair with numeric coordinates while hovering', () => {
      const { container } = renderChart()

      hoverDay(getSvg(container), 3)

      const crosshair = container.querySelector('[data-testid="trend-crosshair"]')
      expect(crosshair).toBeTruthy()
      expect(Number.isFinite(Number(crosshair?.getAttribute('x1')))).toBe(true)
      expect(Number.isFinite(Number(crosshair?.getAttribute('y2')))).toBe(true)
    })

    it('clears the tooltip when the pointer leaves', () => {
      const { container } = renderChart()
      const svg = getSvg(container)

      hoverDay(svg, 3)
      expect(container.querySelector('[data-testid="trend-tooltip"]')).toBeTruthy()

      fireEvent.pointerLeave(svg)
      expect(container.querySelector('[data-testid="trend-tooltip"]')).toBeNull()
    })

    it('stays inert when the element has no measurable size', () => {
      const { container } = renderChart()

      // No rect stub: happy-dom reports zeros, as a real browser does pre-layout.
      fireEvent.pointerMove(getSvg(container), { clientX: 300, clientY: 100 })

      expect(container.querySelector('[data-testid="trend-tooltip"]')).toBeNull()
      expect(container.innerHTML).not.toContain('NaN')
    })

    it('never captures the pointer — hover only, no click gating', () => {
      const { container } = renderChart()
      const svg = getSvg(container)
      const capture = vi.fn()
      svg.setPointerCapture = capture

      hoverDay(svg, 3)
      fireEvent.pointerDown(svg, { clientX: clientXForDay(3), clientY: 100 })
      fireEvent.pointerUp(svg, { clientX: clientXForDay(3), clientY: 100 })

      expect(capture).not.toHaveBeenCalled()
    })
  })

  describe('value formatting', () => {
    it('groups thousands by default', () => {
      const big = series('twitch', 'Twitch followers', [12000, 12040, 12080])
      renderChart({ series: [big] })

      const rows = within(screen.getByRole('table')).getAllByRole('row')
      expect(within(rows[1]).getAllByRole('cell')[0]).toHaveTextContent('12,000')
    })

    it('uses a supplied formatter for the table and the tooltip', () => {
      const { container } = renderChart({ formatValue: (value) => `${value} fans` })

      const rows = within(screen.getByRole('table')).getAllByRole('row')
      expect(within(rows[1]).getAllByRole('cell')[0]).toHaveTextContent('100 fans')

      hoverDay(getSvg(container), 3)
      expect(container.querySelector('[data-testid="trend-tooltip"]')?.textContent).toContain(
        '130 fans',
      )
    })
  })

  describe('empty state', () => {
    it('says so plainly when every reading is a gap', () => {
      const allGaps = series('twitch', 'Twitch followers', [null, null, null])
      const { container } = renderChart({ series: [allGaps] })

      expect(screen.getByText(/no data/i)).toBeTruthy()
      expect(container.querySelector('path')).toBeNull()
      expect(screen.queryByRole('table')).toBeNull()
    })

    it('says so plainly when there are no series at all', () => {
      const { container } = renderChart({ series: [] })

      expect(screen.getByText(/no data/i)).toBeTruthy()
      expect(container.querySelector('path')).toBeNull()
    })

    it('still names the chart in its empty state', () => {
      renderChart({ series: [] })

      expect(screen.getByRole('heading', { name: 'Audience growth' })).toBeTruthy()
    })
  })
})
