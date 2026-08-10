import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { axe } from 'jest-axe'
import { AppSidebar } from '@/components/shell/sidebar'
import AppLayout from '@/app/(app)/layout'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

// Reporting rule ids rather than the raw result objects keeps a failure
// readable — the whole AxeResults dump is unusable as an assertion diff.
async function violationIds(container: HTMLElement): Promise<string[]> {
  const results = await axe(container)
  return results.violations.map((violation) => violation.id)
}

describe('AppSidebar accessibility', () => {
  it('raises no violations — the library Sidebar renders its own aside landmark', async () => {
    const { container } = render(<AppSidebar />)

    expect(await violationIds(container)).toEqual([])
  })

  // A per-component pass is structurally blind to shared chrome: landmark
  // uniqueness, heading order and ARIA references only exist once the shell is
  // assembled. This renders the layout that actually ships — AppShell's <main>
  // plus the sidebar's <aside> plus page content — rather than the sidebar alone.
  it('raises no violations for the assembled (app) shell with page content', async () => {
    const { container } = render(
      <AppLayout>
        <div>
          <h1>Overview</h1>
          <p>Page content lives inside AppShell&apos;s main landmark.</p>
        </div>
      </AppLayout>,
    )

    expect(await violationIds(container)).toEqual([])
  })
})
