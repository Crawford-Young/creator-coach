import Link from 'next/link'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/lib/ui'
import { TrendChart } from '@/components/ui/chart/trend-chart'
import { PlatformCard } from '@/components/dashboard/platform-card'
import { RangePicker } from '@/components/dashboard/range-picker'
import { ReauthBanner } from '@/components/dashboard/reauth-banner'
import { toOverviewCharts, toPlatformCards } from '@/components/dashboard/serialize'
import { rangeDayKeys, type RangePreset } from '@/lib/metrics/range'
import type { DayMetrics } from '@/lib/metrics/query'
import type { LiveStatus } from '@/lib/metrics/live'
import type { PlatformAccountSummary } from '@/lib/platform-accounts'
import type { Platform } from '@/db'

const ONBOARDING_PATH = '/onboarding'

interface EmptyDashboardProps {
  readonly heading: string
  readonly body: string
  readonly children?: React.ReactNode
}

function EmptyDashboard({ heading, body, children }: EmptyDashboardProps): React.JSX.Element {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-2">
        <CardTitle>{heading}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      {children !== undefined && <CardContent>{children}</CardContent>}
    </Card>
  )
}

interface SectionProps {
  readonly id: string
  readonly heading: string
  readonly children: React.ReactNode
  readonly className?: string
}

// The section headings are visually hidden on purpose: the approved layout has
// no group titles, but Card and TrendChart both head themselves with an <h3>,
// and jumping straight from the page <h1> to an <h3> is a heading-order
// violation. These supply the missing level.
function Section({ id, heading, children, className }: SectionProps): React.JSX.Element {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="sr-only">
        {heading}
      </h2>
      <div className={className}>{children}</div>
    </section>
  )
}

export interface DashboardOverviewProps {
  readonly range: RangePreset
  readonly accounts: readonly PlatformAccountSummary[]
  readonly series: readonly DayMetrics[]
  /** Keyed by platform; an absent key means that platform has no live concept. */
  readonly live: Partial<Record<Platform, LiveStatus>>
  /** The request's search params, so the range picker preserves its siblings. */
  readonly params?: URLSearchParams
  /**
   * The request's instant, passed in rather than read here so the day axis is a
   * function of the props alone — the page owns the clock.
   */
  readonly now: number
}

/**
 * The Overview surface: reauth banners, one card per linked platform, and the
 * trend charts for the selected range. Purely presentational — every query has
 * already run by the time it renders, which is what keeps the page itself thin
 * enough to sit in the coverage-excluded `src/app/**` tree.
 */
export function DashboardOverview(props: DashboardOverviewProps): React.JSX.Element {
  const rangeDays = rangeDayKeys(
    props.range,
    new Date(props.now),
    props.series.map((point) => point.day),
  )
  const platforms = props.accounts.map((account) => account.platform)
  const cards = toPlatformCards(props.accounts, props.series, rangeDays, props.live)
  const charts = toOverviewCharts(props.series, platforms, rangeDays)

  return (
    <div className="flex flex-col gap-8 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Overview</h1>
        <RangePicker active={props.range} params={props.params} />
      </header>

      <ReauthBanner accounts={props.accounts} />

      {props.accounts.length === 0 ? (
        <Section id="getting-started-heading" heading="Getting started">
          <EmptyDashboard
            heading="No platforms linked yet"
            body="Link your Twitch or YouTube account to start seeing your numbers here."
          >
            <Button asChild>
              <Link href={ONBOARDING_PATH}>Link a platform</Link>
            </Button>
          </EmptyDashboard>
        </Section>
      ) : props.series.length === 0 ? (
        // True whether the creator just linked an account or picked a range
        // their ingest never covered — the component cannot tell those apart
        // without a second query, so the copy must not claim either.
        <Section id="getting-started-heading" heading="Getting started">
          <EmptyDashboard
            heading="No data for this range yet"
            body="If you just connected an account, your first sync runs tonight — check back tomorrow."
          />
        </Section>
      ) : (
        <>
          <Section id="platforms-heading" heading="Platforms" className="flex flex-col gap-4">
            {cards.map((card) => (
              <PlatformCard key={card.platform} card={card} />
            ))}
          </Section>

          <Section id="trends-heading" heading="Trends" className="grid gap-8 xl:grid-cols-2">
            {charts.map((chart) => (
              <TrendChart
                key={chart.id}
                title={chart.title}
                series={chart.series}
                range={props.range}
              />
            ))}
          </Section>
        </>
      )}
    </div>
  )
}
