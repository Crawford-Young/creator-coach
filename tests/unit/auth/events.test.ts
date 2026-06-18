// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// next-auth imports next/server and next/headers at module load time — mock to prevent errors
vi.mock('next-auth', () => ({
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}))

vi.mock('@/lib/provision', () => ({
  provisionCreator: vi.fn().mockResolvedValue(undefined),
}))

import { authConfig } from '@/lib/auth'
import { provisionCreator } from '@/lib/provision'

describe('authConfig events.signIn', () => {
  it('calls provisionCreator with user id and name on sign-in', async () => {
    await authConfig.events?.signIn?.({ user: { id: 'u1', name: 'Streamer' } } as never)
    expect(provisionCreator).toHaveBeenCalledWith('u1', 'Streamer')
  })

  it('calls provisionCreator with empty string when user.name is null', async () => {
    await authConfig.events?.signIn?.({ user: { id: 'u2', name: null } } as never)
    expect(provisionCreator).toHaveBeenCalledWith('u2', '')
  })
})
