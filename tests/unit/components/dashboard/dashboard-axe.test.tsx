import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { axe } from 'jest-axe'
import AppLayout from '@/app/(app)/layout'
import { DashboardOverview } from '@/components/dashboard/overview'
import {
  OFFLINE,
  OVERVIEW_NOW,
  OVERVIEW_SERIES,
  TWITCH_ACCOUNT,
  YOUTUBE_ACCOUNT,
} from '../../../fixtures/dashboard'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('next-auth/react', () => ({ signIn: vi.fn().mockResolvedValue(undefined) }))

// Reporting rule ids rather than the raw result objects keeps a failure
// readable — the whole AxeResults dump is unusable as an assertion diff.
async function violationIds(container: HTMLElement): Promise<string[]> {
  const results = await axe(container)
  return results.violations.map((violation) => violation.id)
}

// The whole shipped surface — AppShell's <main>, the real sidebar, real cards
// and real charts. A component-level pass cannot see landmark uniqueness or
// heading order across those boundaries, which is exactly what this catches.
describe('Overview surface accessibility', () => {
  it('raises no violations for the populated dashboard inside the app shell', async () => {
    const { container } = render(
      <AppLayout>
        <DashboardOverview
          range="7d"
          accounts={[TWITCH_ACCOUNT, YOUTUBE_ACCOUNT]}
          series={OVERVIEW_SERIES}
          live={{ twitch: { live: true, ccv: 342 } }}
          now={OVERVIEW_NOW}
        />
      </AppLayout>,
    )

    expect(await violationIds(container)).toEqual([])
  })

  it('raises no violations with reauth banners above the cards', async () => {
    const { container } = render(
      <AppLayout>
        <DashboardOverview
          range="90d"
          accounts={[
            { ...TWITCH_ACCOUNT, status: 'reauth_required' },
            { ...YOUTUBE_ACCOUNT, status: 'reauth_required' },
          ]}
          series={OVERVIEW_SERIES}
          live={OFFLINE}
          now={OVERVIEW_NOW}
        />
      </AppLayout>,
    )

    expect(await violationIds(container)).toEqual([])
  })

  it('raises no violations in the nothing-linked empty state', async () => {
    const { container } = render(
      <AppLayout>
        <DashboardOverview
          range="90d"
          accounts={[]}
          series={[]}
          live={OFFLINE}
          now={OVERVIEW_NOW}
        />
      </AppLayout>,
    )

    expect(await violationIds(container)).toEqual([])
  })

  it('raises no violations in the no-data-yet empty state', async () => {
    const { container } = render(
      <AppLayout>
        <DashboardOverview
          range="90d"
          accounts={[TWITCH_ACCOUNT]}
          series={[]}
          live={OFFLINE}
          now={OVERVIEW_NOW}
        />
      </AppLayout>,
    )

    expect(await violationIds(container)).toEqual([])
  })
})
