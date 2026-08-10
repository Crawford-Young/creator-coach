'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ListVideo } from 'lucide-react'
import { Sidebar, SidebarBrand, SidebarItem } from '@/lib/ui'

interface NavItem {
  readonly href: string
  readonly label: string
  readonly icon: React.ReactNode
}

// Design system: 16px is the dominant icon size, 24px the max.
const NAV_ICON_SIZE = 16

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Overview', icon: <LayoutDashboard size={NAV_ICON_SIZE} /> },
  { href: '/content', label: 'Content', icon: <ListVideo size={NAV_ICON_SIZE} /> },
]

export function AppSidebar(): React.JSX.Element {
  const pathname = usePathname()

  return (
    <Sidebar
      header={
        <SidebarBrand
          logo={<LayoutDashboard size={NAV_ICON_SIZE} />}
          title="Creator Coach"
          href="/"
        />
      }
    >
      {NAV_ITEMS.map((item) => (
        <SidebarItem
          key={item.href}
          icon={item.icon}
          label={item.label}
          href={item.href}
          isActive={pathname === item.href}
          asChild
        >
          {/* SidebarItem injects its own icon/label markup around this
              child when asChild is set — the Link owns navigation only,
              it must not render its own text (see dist Slot merge in
              @radix-ui/react-slot: the Link's own children survive
              alongside the injected spans, so a text child here would
              render the label twice). */}
          <Link href={item.href} />
        </SidebarItem>
      ))}
    </Sidebar>
  )
}
