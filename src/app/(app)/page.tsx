import { requireDashboardCreator } from '@/lib/dashboard-auth'

// Placeholder body — T9 replaces this with the real DashboardOverview
// composition. AppShell's <main> already wraps `children` (see
// (app)/layout.tsx), so this renders a plain div, not a second <main>.
export default async function OverviewPage(): Promise<React.JSX.Element> {
  await requireDashboardCreator()

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-2xl font-semibold text-foreground">Creator Coach</h1>
      <p className="text-muted-foreground">Dashboard coming in the next task.</p>
    </div>
  )
}
