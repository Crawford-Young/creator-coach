import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppSidebar } from '@/components/shell/sidebar'

const pathname = vi.hoisted(() => ({ current: '/' }))

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}))

describe('AppSidebar', () => {
  it('renders Overview and Content nav links pointing at their routes', () => {
    pathname.current = '/'
    render(<AppSidebar />)

    expect(screen.getByRole('link', { name: /overview/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /content/i })).toHaveAttribute('href', '/content')
  })

  it('marks Overview active when the pathname is /', () => {
    pathname.current = '/'
    render(<AppSidebar />)

    expect(screen.getByRole('link', { name: /overview/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /content/i })).not.toHaveAttribute('aria-current')
  })

  it('marks Content active when the pathname is /content', () => {
    pathname.current = '/content'
    render(<AppSidebar />)

    expect(screen.getByRole('link', { name: /content/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /overview/i })).not.toHaveAttribute('aria-current')
  })
})
