import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/lib/ui'
import { Sparkline } from '@/components/ui/chart/sparkline'
import { SERIES_COLOR } from '@/components/ui/chart/series-color'
import type { CardPlatform, MetricView, PlatformCardData } from '@/components/dashboard/serialize'
import { DELTA_FORMAT, NUMBER_FORMAT } from '@/lib/format'
import { PLATFORM_LABEL } from '@/lib/platform-labels'
import type { LiveStatus } from '@/lib/metrics/live'

const TREND_ICON_SIZE = 14

type TrendDirection = 'up' | 'down' | 'flat'

const TREND_ICON: Readonly<Record<TrendDirection, React.ElementType>> = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
}

function trendDirection(delta: number): TrendDirection {
  if (delta > 0) return 'up'
  if (delta < 0) return 'down'
  return 'flat'
}

function formatValue(metric: MetricView): string {
  const formatted = NUMBER_FORMAT.format(metric.value)
  return metric.unit === undefined ? formatted : `${formatted} ${metric.unit}`
}

interface MetricBlockProps {
  readonly platform: CardPlatform
  readonly metric: MetricView
}

function MetricBlock({ platform, metric }: MetricBlockProps): React.JSX.Element {
  const direction = metric.delta === null ? null : trendDirection(metric.delta)
  const TrendIcon = direction === null ? null : TREND_ICON[direction]

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {metric.label}
      </p>
      <p className="font-mono text-2xl font-semibold text-foreground">{formatValue(metric)}</p>
      {metric.delta === null || TrendIcon === null ? (
        // A daily metric's value already IS the range; there is no first-vs-last
        // growth figure to put an arrow against (P-14).
        <p className="text-xs text-muted-foreground">summed over range</p>
      ) : (
        <p
          data-testid={`metric-trend-${metric.key}`}
          data-direction={direction}
          className="flex items-center gap-1 text-xs text-muted-foreground"
        >
          <TrendIcon aria-hidden="true" size={TREND_ICON_SIZE} />
          {`${DELTA_FORMAT.format(metric.delta)} in range`}
        </p>
      )}
      {/* P-7: Sparkline's root is height:100%, which resolves to zero in a
          parent with no definite height — this frame is what gives it one. */}
      <div data-testid={`metric-sparkline-${metric.key}`} className="h-8 w-full">
        <Sparkline points={metric.points} color={SERIES_COLOR[platform]} />
      </div>
    </div>
  )
}

interface LiveBadgeProps {
  readonly live: LiveStatus | null
}

function LiveBadge({ live }: LiveBadgeProps): React.JSX.Element | null {
  if (live === null || !live.live) return null
  const label = live.ccv === undefined ? 'LIVE' : `LIVE ${NUMBER_FORMAT.format(live.ccv)} watching`
  return <Badge variant="destructive">{label}</Badge>
}

export interface PlatformCardProps {
  readonly card: PlatformCardData
}

/**
 * One platform's headline numbers: each metric's current figure, how it moved
 * over the selected range, and a sparkline of the same window.
 */
export function PlatformCard({ card }: PlatformCardProps): React.JSX.Element {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="flex flex-col gap-1">
          <CardTitle>{card.title}</CardTitle>
          <CardDescription>{card.handle}</CardDescription>
        </div>
        <LiveBadge live={card.live} />
      </CardHeader>
      {/* A linked platform can be silent while a sibling reports: the page's
          empty state only fires when the WHOLE series is empty, so this card
          has to speak for itself rather than render a header over nothing. */}
      {card.metrics.length === 0 ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {`No ${PLATFORM_LABEL[card.platform]} data for this range yet.`}
          </p>
        </CardContent>
      ) : (
        <CardContent className="grid gap-6 sm:grid-cols-3">
          {card.metrics.map((metric) => (
            <MetricBlock key={metric.key} platform={card.platform} metric={metric} />
          ))}
        </CardContent>
      )}
    </Card>
  )
}
