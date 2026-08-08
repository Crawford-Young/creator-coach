// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// next-auth imports next/server and next/headers at module load time — both are
// Next.js server internals not available in the Vitest node environment.
// We mock the top-level next-auth export so only the plain `authConfig` object
// (which has no Next.js dependencies) is exercised in this test.
vi.mock('next-auth', () => ({
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}))

import { authConfig } from '@/lib/auth'

describe('auth config', () => {
  it('registers the twitch provider', () => {
    const ids = authConfig.providers.map((p) => (typeof p === 'function' ? p().id : p.id))
    expect(ids).toContain('twitch')
  })
  it('uses an adapter', () => {
    expect(authConfig.adapter).toBeDefined()
  })
  it('requests the broadcast + email scopes', () => {
    const twitch = authConfig.providers.find(
      (p) => (typeof p === 'function' ? p().id : p.id) === 'twitch',
    )
    const provider = typeof twitch === 'function' ? twitch() : twitch
    // @auth/core merges `options` over defaults at request-time via parseProviders().
    // At config-object level, our authorization override lives in provider.options.
    // We must read the scope from options to verify what we actually configured.
    const options = (provider as { options?: { authorization?: { params?: { scope?: string } } } })
      ?.options
    const scope = options?.authorization?.params?.scope ?? ''
    expect(scope).toContain('channel:manage:broadcast')
    expect(scope).toContain('user:read:email')
    expect(scope).toContain('channel:read:subscriptions')
    // The provider is OIDC: dropping the default `openid` scope makes Twitch
    // omit id_token and the callback dies "id_token property must be a string".
    expect(scope).toContain('openid')
  })
})
