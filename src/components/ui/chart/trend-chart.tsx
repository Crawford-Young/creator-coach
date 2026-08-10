'use client'

import { useState } from 'react'
import { line as d3Line } from 'd3-shape'
import { segmentSeries, type ChartPoint } from '@/components/ui/chart/segment'
import { makeScales, TICK_COUNT } from '@/components/ui/chart/scales'
import { nearestPoint } from '@/components/ui/chart/nearest'
import type { RangePreset } from '@/lib/metrics/query'

const VIEWBOX_WIDTH = 640
const VIEWBOX_HEIGHT = 260
const MARGIN_TOP = 16
const MARGIN_RIGHT = 16
const MARGIN_BOTTOM = 32
const MARGIN_LEFT = 56
const PLOT_WIDTH = VIEWBOX_WIDTH - MARGIN_LEFT - MARGIN_RIGHT
const PLOT_HEIGHT = VIEWBOX_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM

const SERIES_STROKE_WIDTH = 2
const RULE_STROKE_WIDTH = 1
const MARKER_RADIUS = 3
const Y_TICK_COUNT = 4
const AXIS_FONT_SIZE = 11
const Y_LABEL_GAP = 8
const X_LABEL_GAP = 20
const LEGEND_MIN_SERIES = 2
const PERCENT = 100

const GAP_LABEL = '—'
const NUMBER_FORMAT = new Intl.NumberFormat('en-US')
const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
})

export interface TrendSeries {
  readonly id: 'twitch' | 'youtube'
  readonly label: string
  readonly points: readonly ChartPoint[]
}

export const SERIES_COLOR: Readonly<Record<TrendSeries['id'], string>> = {
  twitch: 'var(--series-twitch)',
  youtube: 'var(--series-youtube)',
}

export interface TrendChartProps {
  readonly title: string
  readonly series: readonly TrendSeries[]
  readonly range: RangePreset
  readonly formatValue?: (value: number) => string
}

interface SeriesReading {
  readonly series: TrendSeries
  readonly value: number
}

function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value)
}

function formatDay(t: number): string {
  return DAY_FORMAT.format(new Date(t))
}

function valueAt(entry: TrendSeries, t: number): number | null {
  const point = entry.points.find((candidate) => candidate.t === t)
  return point === undefined ? null : point.v
}

/** Every day any series mentions, ascending — the shared row axis. */
function collectDays(series: readonly TrendSeries[]): number[] {
  const days = new Set<number>()
  for (const entry of series) {
    for (const point of entry.points) days.add(point.t)
  }
  return [...days].sort((a, b) => a - b)
}

function readingsAt(series: readonly TrendSeries[], t: number): SeriesReading[] {
  const readings: SeriesReading[] = []
  for (const entry of series) {
    const value = valueAt(entry, t)
    if (value !== null) readings.push({ series: entry, value })
  }
  return readings
}

/**
 * The single ascending track the crosshair snaps to: one point per day that at
 * least one series has a real reading for, valued by how many series reported
 * it. Concatenating the per-series segments instead would interleave two
 * ascending runs into a non-monotonic list, and `nearestPoint`'s binary search
 * requires ascending time.
 */
function hoverTrack(series: readonly TrendSeries[], days: readonly number[]): ChartPoint[] {
  return days.map((t) => ({ t, v: readingsAt(series, t).length })).filter((point) => point.v > 0)
}

export function TrendChart(props: TrendChartProps): React.JSX.Element {
  const [hovered, setHovered] = useState<ChartPoint | null>(null)

  const days = collectDays(props.series)
  const track = hoverTrack(props.series, days)
  const formatValue = props.formatValue ?? formatCount

  if (track.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">{props.title}</h3>
        <p className="py-8 text-center text-sm text-muted-foreground">
          No data for this range yet.
        </p>
      </div>
    )
  }

  const plotted = props.series.map((entry) => ({
    entry,
    segments: segmentSeries(entry.points),
  }))
  const { x, y } = makeScales(
    plotted.flatMap((item) => item.segments),
    PLOT_WIDTH,
    PLOT_HEIGHT,
  )

  // segmentSeries only ever pushes points with v !== null into a segment, so
  // the `as number` reflects that invariant rather than an unchecked guess.
  const line = d3Line<ChartPoint>()
    .x((point) => x(point.t))
    .y((point) => y(point.v as number))

  const readings = hovered === null ? [] : readingsAt(props.series, hovered.t)

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>): void {
    const rect = event.currentTarget.getBoundingClientRect()
    // A browser reports an all-zero rect before layout, as happy-dom always
    // does; dividing by that width would seed every coordinate with NaN.
    if (rect.width === 0) return
    const plotX = ((event.clientX - rect.left) / rect.width) * VIEWBOX_WIDTH - MARGIN_LEFT
    setHovered(nearestPoint([track], x.invert(plotX).getTime()))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{props.title}</h3>
        {props.series.length >= LEGEND_MIN_SERIES && (
          <ul aria-label="Chart series" className="flex flex-wrap gap-4">
            {props.series.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: SERIES_COLOR[entry.id] }}
                />
                {entry.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="relative">
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          style={{ width: '100%', height: 'auto' }}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHovered(null)}
        >
          <g transform={`translate(${MARGIN_LEFT},${MARGIN_TOP})`}>
            <g data-axis="y">
              {y.ticks(Y_TICK_COUNT).map((tick) => (
                <g key={tick}>
                  <line
                    x1={0}
                    x2={PLOT_WIDTH}
                    y1={y(tick)}
                    y2={y(tick)}
                    stroke="var(--border)"
                    strokeWidth={RULE_STROKE_WIDTH}
                  />
                  <text
                    x={-Y_LABEL_GAP}
                    y={y(tick)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fontSize={AXIS_FONT_SIZE}
                    fill="var(--muted-foreground)"
                  >
                    {formatValue(tick)}
                  </text>
                </g>
              ))}
            </g>

            <g data-axis="x">
              {x.ticks(TICK_COUNT[props.range]).map((tick) => (
                <text
                  key={tick.getTime()}
                  x={x(tick)}
                  y={PLOT_HEIGHT + X_LABEL_GAP}
                  textAnchor="middle"
                  fontSize={AXIS_FONT_SIZE}
                  fill="var(--muted-foreground)"
                >
                  {formatDay(tick.getTime())}
                </text>
              ))}
            </g>

            {plotted.map((item) =>
              item.segments.map((segment, index) => (
                <path
                  key={`${item.entry.id}-${index}`}
                  // segmentSeries never emits an empty segment, so d3's line()
                  // always has a defined point and never returns null here; a
                  // `?? ''` fallback would be an unreachable branch.
                  d={line(segment) as string}
                  fill="none"
                  stroke={SERIES_COLOR[item.entry.id]}
                  strokeWidth={SERIES_STROKE_WIDTH}
                  // A lone reading between two gaps is a zero-length path; a
                  // round cap is what makes it render as a dot.
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )),
            )}

            {hovered !== null && (
              <g>
                <line
                  data-testid="trend-crosshair"
                  x1={x(hovered.t)}
                  x2={x(hovered.t)}
                  y1={0}
                  y2={PLOT_HEIGHT}
                  stroke="var(--muted-foreground)"
                  strokeWidth={RULE_STROKE_WIDTH}
                />
                {readings.map((reading) => (
                  <circle
                    key={reading.series.id}
                    cx={x(hovered.t)}
                    cy={y(reading.value)}
                    r={MARKER_RADIUS}
                    fill={SERIES_COLOR[reading.series.id]}
                  />
                ))}
              </g>
            )}
          </g>
        </svg>

        {hovered !== null && (
          <div
            aria-hidden="true"
            data-testid="trend-tooltip"
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md"
            style={{ left: `${((MARGIN_LEFT + x(hovered.t)) / VIEWBOX_WIDTH) * PERCENT}%` }}
          >
            <p className="font-medium text-foreground">{formatDay(hovered.t)}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {readings.map((reading) => (
                <li key={reading.series.id} className="flex items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: SERIES_COLOR[reading.series.id] }}
                  />
                  <span className="text-muted-foreground">{reading.series.label}</span>
                  <span className="ml-auto font-medium text-foreground">
                    {formatValue(reading.value)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>{props.title}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {props.series.map((entry) => (
              <th key={entry.id} scope="col">
                {entry.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((t) => (
            <tr key={t}>
              <th scope="row">{formatDay(t)}</th>
              {props.series.map((entry) => {
                const value = valueAt(entry, t)
                return <td key={entry.id}>{value === null ? GAP_LABEL : formatValue(value)}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
