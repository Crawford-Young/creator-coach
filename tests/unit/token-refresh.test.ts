// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, type PlatformAccountDoc } from '@/db'
import { decryptToken, encryptToken } from '@/lib/token-crypto'
import { env } from '@/env'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import {
  getFreshTwitchToken,
  getFreshGoogleToken,
  TOKEN_EXPIRY_MARGIN_SEC,
  ReauthRequiredError,
} from '@/lib/connectors/token-refresh'

const TWITCH_REFRESH_URL = 'https://id.twitch.tv/oauth2/token'
const GOOGLE_REFRESH_URL = 'https://oauth2.googleapis.com/token'
const SECONDS_TO_MS = 1000

interface FetchFixture {
  ok?: boolean
  status?: number
  body: unknown
}

function mockFetchSequence(responses: FetchFixture[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn()
  for (const res of responses) {
    fetchMock.mockImplementationOnce(async () => ({
      ok: res.ok ?? true,
      status: res.status ?? 200,
      json: async () => res.body,
    }))
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function futureDate(secondsFromNow: number): Date {
  return new Date(Date.now() + secondsFromNow * SECONDS_TO_MS)
}

async function seedAccount(
  overrides: Partial<PlatformAccountDoc> = {},
): Promise<PlatformAccountDoc> {
  const doc: PlatformAccountDoc = {
    _id: new ObjectId(),
    creatorId: new ObjectId().toHexString(),
    platform: 'twitch',
    externalId: 'ext-1',
    handle: 'Handle',
    accessToken: encryptToken('old-access-token'),
    refreshToken: encryptToken('old-refresh-token'),
    tokenExpiresAt: futureDate(3600),
    scopes: ['channel:read:subscriptions'],
    status: 'active',
    linkedAt: new Date(),
    ...overrides,
  }
  await collections().platformAccounts.insertOne(doc)
  return doc
}

function fixtureRefreshResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: 'new-access-token',
    expires_in: 14400,
    refresh_token: 'new-refresh-token',
    scope: 'some.scope',
    token_type: 'bearer',
    ...overrides,
  }
}

async function readBack(id: ObjectId): Promise<PlatformAccountDoc> {
  const doc = await collections().platformAccounts.findOne({ _id: id })
  if (!doc) throw new Error('test setup: platformAccounts doc unexpectedly missing')
  return doc
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(Sentry.captureException).mockClear()
})

describe('getFreshTwitchToken / getFreshGoogleToken — fresh token, no refresh', () => {
  it('twitch: fresh expiry returns decrypted plaintext without calling fetch or writing the doc', async () => {
    const account = await seedAccount({
      platform: 'twitch',
      accessToken: encryptToken('current-token'),
    })
    const fetchMock = mockFetchSequence([])

    const result = await getFreshTwitchToken(account)

    expect(result.accessToken).toBe('current-token')
    expect(fetchMock).not.toHaveBeenCalled()
    const doc = await readBack(account._id)
    expect(decryptToken(doc.accessToken)).toBe('current-token')
    expect(doc.status).toBe('active')
  })

  it('google: fresh expiry returns decrypted plaintext without calling fetch or writing the doc', async () => {
    const account = await seedAccount({
      platform: 'youtube',
      accessToken: encryptToken('current-token'),
    })
    const fetchMock = mockFetchSequence([])

    const result = await getFreshGoogleToken(account)

    expect(result.accessToken).toBe('current-token')
    expect(fetchMock).not.toHaveBeenCalled()
    const doc = await readBack(account._id)
    expect(decryptToken(doc.accessToken)).toBe('current-token')
    expect(doc.status).toBe('active')
  })
})

describe('getFreshTwitchToken / getFreshGoogleToken — expired token refreshes and persists', () => {
  it('twitch: expired token refreshes, persists the ROTATED refresh token (critical), and returns new plaintext', async () => {
    const account = await seedAccount({
      platform: 'twitch',
      tokenExpiresAt: futureDate(-60),
    })
    mockFetchSequence([{ body: fixtureRefreshResponse() }])

    const result = await getFreshTwitchToken(account)

    expect(result.accessToken).toBe('new-access-token')
    const doc = await readBack(account._id)
    expect(decryptToken(doc.accessToken)).toBe('new-access-token')
    // THE critical assertion: Twitch rotates the refresh token on every
    // successful refresh — failing to persist it breaks all subsequent
    // refreshes (dev.twitch.tv, doc-verbatim per brief).
    expect(decryptToken(doc.refreshToken!)).toBe('new-refresh-token')
    const expectedExpiry = Date.now() + 14400 * SECONDS_TO_MS
    expect(Math.abs(doc.tokenExpiresAt!.getTime() - expectedExpiry)).toBeLessThan(5000)
    expect(doc.status).toBe('active')
  })

  it('google: expired token refreshes and persists the new access token', async () => {
    const account = await seedAccount({
      platform: 'youtube',
      tokenExpiresAt: futureDate(-60),
    })
    mockFetchSequence([{ body: fixtureRefreshResponse() }])

    const result = await getFreshGoogleToken(account)

    expect(result.accessToken).toBe('new-access-token')
    const doc = await readBack(account._id)
    expect(decryptToken(doc.accessToken)).toBe('new-access-token')
    expect(decryptToken(doc.refreshToken!)).toBe('new-refresh-token')
    const expectedExpiry = Date.now() + 14400 * SECONDS_TO_MS
    expect(Math.abs(doc.tokenExpiresAt!.getTime() - expectedExpiry)).toBeLessThan(5000)
    expect(doc.status).toBe('active')
  })
})

describe('freshness edge cases', () => {
  it('refreshes when expiry falls inside the margin window', async () => {
    expect(TOKEN_EXPIRY_MARGIN_SEC).toBe(300)
    const account = await seedAccount({
      platform: 'twitch',
      tokenExpiresAt: futureDate(200),
    })
    const fetchMock = mockFetchSequence([{ body: fixtureRefreshResponse() }])

    await getFreshTwitchToken(account)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes when tokenExpiresAt is absent and a refreshToken is stored', async () => {
    const account = await seedAccount({ platform: 'youtube', tokenExpiresAt: undefined })
    const fetchMock = mockFetchSequence([{ body: fixtureRefreshResponse() }])

    await getFreshGoogleToken(account)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('forceRefresh: true refreshes even with a fresh expiry', async () => {
    const account = await seedAccount({ platform: 'twitch', tokenExpiresAt: futureDate(3600) })
    const fetchMock = mockFetchSequence([{ body: fixtureRefreshResponse() }])

    await getFreshTwitchToken(account, { forceRefresh: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('refresh failure -> reauth_required', () => {
  it('twitch: 401 from the refresh endpoint flips status, reports to Sentry, and throws ReauthRequiredError', async () => {
    const account = await seedAccount({ platform: 'twitch', tokenExpiresAt: futureDate(-60) })
    mockFetchSequence([{ ok: false, status: 401, body: { message: 'Invalid refresh token' } }])

    await expect(getFreshTwitchToken(account)).rejects.toThrow(ReauthRequiredError)

    const doc = await readBack(account._id)
    expect(doc.status).toBe('reauth_required')
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('google: 401 from the refresh endpoint flips status, reports to Sentry, and throws ReauthRequiredError', async () => {
    const account = await seedAccount({ platform: 'youtube', tokenExpiresAt: futureDate(-60) })
    mockFetchSequence([{ ok: false, status: 401, body: { error: 'invalid_grant' } }])

    await expect(getFreshGoogleToken(account)).rejects.toThrow(ReauthRequiredError)

    const doc = await readBack(account._id)
    expect(doc.status).toBe('reauth_required')
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('expired token with no stored refreshToken flips to reauth_required without calling fetch', async () => {
    const account = await seedAccount({
      platform: 'twitch',
      tokenExpiresAt: futureDate(-60),
      refreshToken: undefined,
    })
    const fetchMock = mockFetchSequence([])

    await expect(getFreshTwitchToken(account)).rejects.toThrow(ReauthRequiredError)

    expect(fetchMock).not.toHaveBeenCalled()
    const doc = await readBack(account._id)
    expect(doc.status).toBe('reauth_required')
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('a schema-violating refresh response also flips to reauth_required', async () => {
    const account = await seedAccount({ platform: 'twitch', tokenExpiresAt: futureDate(-60) })
    mockFetchSequence([{ body: fixtureRefreshResponse({ access_token: undefined }) }])

    await expect(getFreshTwitchToken(account)).rejects.toThrow(ReauthRequiredError)

    const doc = await readBack(account._id)
    expect(doc.status).toBe('reauth_required')
  })
})

describe('google refresh response without a new refresh_token', () => {
  it('preserves the stored refreshToken (decrypts to the OLD value) when Google omits it', async () => {
    const account = await seedAccount({
      platform: 'youtube',
      tokenExpiresAt: futureDate(-60),
      refreshToken: encryptToken('original-google-refresh'),
    })
    mockFetchSequence([{ body: fixtureRefreshResponse({ refresh_token: undefined }) }])

    await getFreshGoogleToken(account)

    const doc = await readBack(account._id)
    expect(decryptToken(doc.refreshToken!)).toBe('original-google-refresh')
    expect(decryptToken(doc.accessToken)).toBe('new-access-token')
  })
})

describe('request shape', () => {
  it('twitch: POSTs form-encoded body with grant_type=refresh_token and client creds; URL carries no secret', async () => {
    const account = await seedAccount({ platform: 'twitch', tokenExpiresAt: futureDate(-60) })
    const fetchMock = mockFetchSequence([{ body: fixtureRefreshResponse() }])

    await getFreshTwitchToken(account)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe(TWITCH_REFRESH_URL)
    expect(String(url)).not.toContain(env.AUTH_TWITCH_SECRET)
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(URLSearchParams)
    const body = init.body as URLSearchParams
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('client_id')).toBe(env.AUTH_TWITCH_ID)
    expect(body.get('client_secret')).toBe(env.AUTH_TWITCH_SECRET)
    expect(body.get('refresh_token')).toBe('old-refresh-token')
  })

  // A2: Google refresh-grant body = RFC 6749 shape — verify at first live
  // refresh; correct connector if Google errors. (Google's own docs page for
  // this shape was truncated at doc-recon time; the code-exchange body shape
  // is confirmed, the refresh-grant body shape is an assumption.)
  it('google: POSTs form-encoded body with grant_type=refresh_token and client creds; URL carries no secret', async () => {
    const account = await seedAccount({ platform: 'youtube', tokenExpiresAt: futureDate(-60) })
    const fetchMock = mockFetchSequence([{ body: fixtureRefreshResponse() }])

    await getFreshGoogleToken(account)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe(GOOGLE_REFRESH_URL)
    expect(String(url)).not.toContain(env.AUTH_GOOGLE_SECRET)
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(URLSearchParams)
    const body = init.body as URLSearchParams
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('client_id')).toBe(env.AUTH_GOOGLE_ID)
    expect(body.get('client_secret')).toBe(env.AUTH_GOOGLE_SECRET)
    expect(body.get('refresh_token')).toBe('old-refresh-token')
  })
})
