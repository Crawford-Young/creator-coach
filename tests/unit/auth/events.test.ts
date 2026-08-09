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

vi.mock('@/lib/connections/twitch-sync', () => ({
  syncTwitchAccount: vi.fn().mockResolvedValue(undefined),
}))

import { authConfig } from '@/lib/auth'
import { provisionCreator } from '@/lib/provision'
import { syncTwitchAccount } from '@/lib/connections/twitch-sync'

describe('authConfig events.signIn', () => {
  it('calls provisionCreator with user id and name on sign-in', async () => {
    await authConfig.events?.signIn?.({ user: { id: 'u1', name: 'Streamer' } } as never)
    expect(provisionCreator).toHaveBeenCalledWith('u1', 'Streamer')
  })

  it('calls provisionCreator with empty string when user.name is null', async () => {
    await authConfig.events?.signIn?.({ user: { id: 'u2', name: null } } as never)
    expect(provisionCreator).toHaveBeenCalledWith('u2', '')
  })

  // W1 issue #6: syncTwitchAccount must receive the signIn EVENT's own fresh
  // `account` object — never re-derive it by reading the adapter's stored
  // row (that row is only written at first link and goes stale on repeat
  // sign-ins).
  it('passes the signIn event account through to syncTwitchAccount', async () => {
    const account = { provider: 'twitch', providerAccountId: 'ext-1', type: 'oauth' } as never
    await authConfig.events?.signIn?.({ user: { id: 'u3', name: 'Streamer' }, account } as never)
    expect(syncTwitchAccount).toHaveBeenCalledWith('u3', 'Streamer', account)
  })
})
