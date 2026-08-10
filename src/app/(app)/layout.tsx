import { AppShell } from '@/lib/ui'
import { AppSidebar } from '@/components/shell/sidebar'

interface AppLayoutProps {
  readonly children: React.ReactNode
}

// No auth here — a partial-render trap (the shell would flash before a
// redirect resolves). Each page owns requireDashboardCreator() itself.
export default function AppLayout({ children }: AppLayoutProps): React.JSX.Element {
  return (
    <AppShell sidebar={<AppSidebar />} topbar={null}>
      {children}
    </AppShell>
  )
}
