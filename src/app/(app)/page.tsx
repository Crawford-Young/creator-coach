import { requireDashboardCreator } from '@/lib/dashboard-auth'
import { listPlatformAccounts } from '@/lib/platform-accounts'
import { queryChannelSeries } from '@/lib/metrics/query'
import { getLiveStatuses } from '@/lib/metrics/live'
import { parseRange, RANGE_PARAM } from '@/lib/metrics/range'
import { toSearchParams, type RawSearchParams } from '@/lib/search-params'
import { DashboardOverview } from '@/components/dashboard/overview'

interface OverviewPageProps {
  readonly searchParams: Promise<RawSearchParams>
}

// Fetch and compose only — src/app/** is coverage-excluded, so every decision
// worth testing lives in DashboardOverview and the modules below it. AppShell's
// <main> already wraps children ((app)/layout.tsx), so this renders no landmark
// of its own.
export default async function OverviewPage({
  searchParams,
}: OverviewPageProps): Promise<React.JSX.Element> {
  const creator = await requireDashboardCreator()
  const params = toSearchParams(await searchParams)
  const range = parseRange(params.get(RANGE_PARAM))
  // One clock read for the whole request: the query window and the rendered day
  // axis must be measured back from the SAME instant.
  // An async Server Component renders once per request, so request time is
  // stable here and no re-render exists to disagree with it.
  const now = new Date()

  // The linked accounts decide which platforms to query, so they resolve first;
  // the two data queries are independent of each other.
  const accounts = await listPlatformAccounts(creator.id)
  const platforms = accounts.map((account) => account.platform)
  const [series, live] = await Promise.all([
    queryChannelSeries(creator.id, { platforms, range, now }),
    getLiveStatuses(creator.id, platforms, now),
  ])

  return (
    <DashboardOverview
      range={range}
      accounts={accounts}
      series={series}
      live={live}
      params={params}
      now={now.getTime()}
    />
  )
}
