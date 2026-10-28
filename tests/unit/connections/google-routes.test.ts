// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Rule under test: the google connect routes gate on the session creator and
// own the OAuth state cookie's whole lifecycle — set httpOnly on a narrow
// path at start, cleared on that SAME path at callback. The link logic itself
// (handleGoogleCallback) is covered in google-link.test.ts.

// next-auth cannot load under vitest; tenant only needs `auth` to exist.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant')>()),
  requireCreator: vi.fn(),
}))
vi.mock('@/lib/connections/google-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/connections/google-link')>()),
  handleGoogleCallback: vi.fn(),
}))

import { requireCreator, UnauthorizedError } from '@/lib/tenant'
import {
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_COOKIE_PATH,
  StateMismatchError,
  TokenExchangeError,
  handleGoogleCallback,
} from '@/lib/connections/google-link'
import { GET as startGET } from '@/app/api/connections/google/start/route'
import { GET as callbackGET } from '@/app/api/connections/google/callback/route'

const BASE = 'http://localhost:3000/api/connections/google'

function stateCookieHeader(response: Response): string {
  const header = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${GOOGLE_STATE_COOKIE}=`))
  expect(header).toBeDefined()
  return header as string
}

function expectStateCookieCleared(response: Response): void {
  const header = stateCookieHeader(response)
  expect(header).toMatch(new RegExp(`^${GOOGLE_STATE_COOKIE}=;`))
  expect(header).toContain('Expires=Thu, 01 Jan 1970')
  // A deletion on any other path leaves the real cookie alive in the browser.
  expect(header).toContain(`Path=${GOOGLE_STATE_COOKIE_PATH}`)
}

function callbackRequest(query: string, cookie?: string): NextRequest {
  return new NextRequest(`${BASE}/callback?${query}`, {
    headers: cookie ? { cookie: `${GOOGLE_STATE_COOKIE}=${cookie}` } : {},
  })
}

beforeEach(() => {
  vi.mocked(requireCreator).mockReset()
  vi.mocked(handleGoogleCallback).mockReset()
})

describe('GET /api/connections/google/start', () => {
  it('returns 401 and sets no cookie when there is no creator session', async () => {
    vi.mocked(requireCreator).mockRejectedValueOnce(new UnauthorizedError())

    const response = await startGET()

    expect(response.status).toBe(401)
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('redirects to Google with a state that matches an httpOnly, path-scoped cookie', async () => {
    vi.mocked(requireCreator).mockResolvedValueOnce({ id: 'creator-a' } as never)

    const response = await startGET()

    const location = new URL(response.headers.get('location') ?? '')
    expect(location.origin).toBe('https://accounts.google.com')
    const state = location.searchParams.get('state')
    expect(state).toMatch(/^[0-9a-f]{64}$/)

    const header = stateCookieHeader(response)
    expect(header).toContain(`${GOOGLE_STATE_COOKIE}=${state};`)
    expect(header).toContain('HttpOnly')
    expect(header).toMatch(/SameSite=lax/i)
    expect(header).toContain(`Path=${GOOGLE_STATE_COOKIE_PATH}`)
  })

  it('rethrows a non-auth failure instead of masking it as a 401', async () => {
    vi.mocked(requireCreator).mockRejectedValueOnce(new Error('db down'))

    await expect(startGET()).rejects.toThrow('db down')
  })
})

describe('GET /api/connections/google/callback', () => {
  it('returns 401 without attempting the link when there is no creator session', async () => {
    vi.mocked(requireCreator).mockRejectedValueOnce(new UnauthorizedError())

    const response = await callbackGET(callbackRequest('code=c&state=s', 's'))

    expect(response.status).toBe(401)
    expect(handleGoogleCallback).not.toHaveBeenCalled()
  })

  it('links for the SESSION creator, passing the query state and the cookie state through', async () => {
    vi.mocked(requireCreator).mockResolvedValueOnce({ id: 'creator-a' } as never)

    const response = await callbackGET(callbackRequest('code=c&state=s1', 's2'))

    expect(handleGoogleCallback).toHaveBeenCalledWith({
      code: 'c',
      state: 's1',
      stateCookie: 's2',
      creatorId: 'creator-a',
    })
    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/')
    expectStateCookieCleared(response)
  })

  it('returns 403 on a state mismatch', async () => {
    vi.mocked(requireCreator).mockResolvedValueOnce({ id: 'creator-a' } as never)
    vi.mocked(handleGoogleCallback).mockRejectedValueOnce(new StateMismatchError())

    const response = await callbackGET(callbackRequest('code=c&state=forged'))

    expect(response.status).toBe(403)
  })

  it('redirects with an error flag and still clears the state cookie when the link fails', async () => {
    vi.mocked(requireCreator).mockResolvedValueOnce({ id: 'creator-a' } as never)
    vi.mocked(handleGoogleCallback).mockRejectedValueOnce(new TokenExchangeError())

    const response = await callbackGET(callbackRequest('code=c&state=s', 's'))

    const location = new URL(response.headers.get('location') ?? '')
    expect(location.pathname).toBe('/')
    expect(location.searchParams.get('googleLinkError')).toBe('1')
    expectStateCookieCleared(response)
  })
})
