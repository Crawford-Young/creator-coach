'use client'

import { line as d3Line } from 'd3-shape'
import { segmentSeries, type ChartPoint } from '@/components/ui/chart/segment'
import { makeScales } from '@/components/ui/chart/scales'

const DEFAULT_WIDTH = 120
const DEFAULT_HEIGHT = 32
const STROKE_WIDTH = 2
const POINT_RADIUS = 2
const EMPTY_STATE_STROKE_WIDTH = 1
const EMPTY_STATE_DASH = '2,2'

export interface SparklineProps {
  readonly points: readonly ChartPoint[]
  readonly color: string
  readonly width?: number
  readonly height?: number
}

// Fixed viewBox + CSS width:100% — never measured (happy-dom, and browsers
// pre-layout, both report a zero getBoundingClientRect for an unmounted-sized
// element), so the SVG always has real geometry to draw into.
export function Sparkline(props: SparklineProps): React.JSX.Element {
  const width = props.width ?? DEFAULT_WIDTH
  const height = props.height ?? DEFAULT_HEIGHT
  const viewBox = `0 0 ${width} ${height}`
  const style = { width: '100%', height: '100%' }

  if (props.points.length === 0) {
    return (
      <svg aria-hidden="true" viewBox={viewBox} style={style}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={EMPTY_STATE_STROKE_WIDTH}
          strokeDasharray={EMPTY_STATE_DASH}
        />
      </svg>
    )
  }

  const segments = segmentSeries(props.points)
  const { x, y } = makeScales(segments, width, height)
  // segmentSeries only ever pushes points with v !== null into a segment
  // (a null point closes the current segment instead) — the `as number`
  // casts below reflect that invariant, not an unchecked assumption.
  const line = d3Line<ChartPoint>()
    .x((point) => x(point.t))
    .y((point) => y(point.v as number))

  return (
    <svg aria-hidden="true" viewBox={viewBox} style={style}>
      {segments.map((segment, index) =>
        segment.length === 1 ? (
          <circle
            key={index}
            cx={x(segment[0].t)}
            cy={y(segment[0].v as number)}
            r={POINT_RADIUS}
            fill={props.color}
          />
        ) : (
          <path
            key={index}
            // segment.length is always >=2 here (segmentSeries never emits
            // empty segments, and the length===1 case is the branch above),
            // so d3's line() always has defined points to draw and never
            // returns null — a `?? ''` fallback would be an untestable branch.
            d={line(segment) as string}
            fill="none"
            stroke={props.color}
            strokeWidth={STROKE_WIDTH}
          />
        ),
      )}
    </svg>
  )
}
