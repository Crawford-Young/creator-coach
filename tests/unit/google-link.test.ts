// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, type CreatorDoc } from '@/db'
import { decryptToken, isEncrypted } from '@/lib/token-crypto'
import { env } from '@/env'

vi.mock('@/lib/ingest/youtube-backfill', () => ({
  backfillYouTubeChannel: vi.fn().mockResolvedValue({ daysWritten: 0, daysSkipped: 0, chunks: 0 }),
}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { backfillYouTubeChannel } from '@/lib/ingest/youtube-backfill'
import {
  buildGoogleAuthUrl,
  generateState,
  handleGoogleCallback,
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_LINK_SCOPES,
  StateMismatchError,
  ScopeDeniedError,
  TokenExchangeError,
  ChannelLookupError,
} from '@/lib/connections/google-link'

const YOUTUBE_CHANNELS_URL =
  'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true'

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

function fixtureTokenResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: 'plain-google-access-token',
    expires_in: 3600,
    refresh_token: 'plain-google-refresh-token',
    scope: GOOGLE_LINK_SCOPES.join(' '),
    token_type: 'Bearer',
    ...overrides,
  }
}

function fixtureChannelsResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    items: [{ id: 'yt-channel-1', snippet: { title: 'MyChannel' } }],
    ...overrides,
  }
}

async function seedCreator(
  platforms: string[] = [],
): Promise<{ creatorId: string; userId: string }> {
  const _id = new ObjectId()
  const userId = randomUUID()
  const doc: CreatorDoc = {
    _id,
    userId,
    displayName: 'Streamer',
    timezone: 'UTC',
    platforms,
    createdAt: new Date(),
  }
  await collections().creators.insertOne(doc)
  return { creatorId: _id.toHexString(), userId }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(backfillYouTubeChannel).mockClear()
  vi.mocked(Sentry.captureException).mockClear()
})

describe('generateState', () => {
  it('generates a 64-character hex string that differs between calls', () => {
    const first = generateState()
    const second = generateState()
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toMatch(/^[0-9a-f]{64}$/)
    expect(first).not.toBe(second)
  })
})

describe('buildGoogleAuthUrl', () => {
  it('builds the Google consent URL with required params and no client_secret', () => {
    const built = new URL(buildGoogleAuthUrl('st4te'))
    expect(`${built.origin}${built.pathname}`).toBe(GOOGLE_AUTH_URL)
    expect(built.searchParams.get('access_type')).toBe('offline')
    expect(built.searchParams.get('prompt')).toBe('consent')
    expect(built.searchParams.get('include_granted_scopes')).toBe('true')
    expect(built.searchParams.get('response_type')).toBe('code')
    const scopeParam = built.searchParams.get('scope') ?? ''
    for (const scope of GOOGLE_LINK_SCOPES) {
      expect(scopeParam).toContain(scope)
    }
    expect(built.searchParams.get('state')).toBe('st4te')
    expect(built.searchParams.get('client_id')).toBe(env.AUTH_GOOGLE_ID)
    expect(built.searchParams.get('redirect_uri')).toMatch(/\/api\/connections\/google\/callback$/)
    expect(built.searchParams.has('client_secret')).toBe(false)
  })
})

describe('handleGoogleCallback', () => {
  it('rejects a state mismatch without calling fetch or writing a doc', async () => {
    const { creatorId } = await seedCreator()
    const fetchMock = mockFetchSequence([])

    await expect(
      handleGoogleCallback({ code: 'abc', state: 'a', stateCookie: 'b', creatorId }),
    ).rejects.toThrow(StateMismatchError)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(backfillYouTubeChannel).not.toHaveBeenCalled()

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'youtube' })
    expect(doc).toBeNull()
  })

  it('rejects an empty state cookie without calling fetch', async () => {
    const { creatorId } = await seedCreator()
    const fetchMock = mockFetchSequence([])

    await expect(
      handleGoogleCallback({ code: 'abc', state: 'a', stateCookie: '', creatorId }),
    ).rejects.toThrow(StateMismatchError)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(backfillYouTubeChannel).not.toHaveBeenCalled()
  })

  it('links youtube on the happy path: encrypts tokens, sets fields, adds the platform exactly once', async () => {
    const { creatorId } = await seedCreator(['twitch'])
    mockFetchSequence([{ body: fixtureTokenResponse() }, { body: fixtureChannelsResponse() }])

    await handleGoogleCallback({ code: 'abc', state: 's', stateCookie: 's', creatorId })

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'youtube' })
    expect(doc).not.toBeNull()
    expect(isEncrypted(doc!.accessToken)).toBe(true)
    expect(decryptToken(doc!.accessToken)).toBe('plain-google-access-token')
    expect(isEncrypted(doc!.refreshToken!)).toBe(true)
    expect(decryptToken(doc!.refreshToken!)).toBe('plain-google-refresh-token')
    expect(doc!.scopes).toEqual(GOOGLE_LINK_SCOPES)
    expect(doc!.status).toBe('active')
    expect(doc!.externalId).toBe('yt-channel-1')
    expect(doc!.handle).toBe('MyChannel')
    expect(doc!.linkedAt).toBeInstanceOf(Date)
    const expectedExpiry = Date.now() + 3600 * 1000
    expect(Math.abs(doc!.tokenExpiresAt!.getTime() - expectedExpiry)).toBeLessThan(5000)

    const creator = await collections().creators.findOne({ _id: new ObjectId(creatorId) })
    expect(creator?.platforms).toEqual(expect.arrayContaining(['twitch', 'youtube']))

    // Fire-and-forget backfill: invoked with the just-upserted account doc
    // (re-fetched, since updateOne's upsert doesn't return it), not awaited
    // by handleGoogleCallback itself.
    expect(backfillYouTubeChannel).toHaveBeenCalledTimes(1)
    expect(backfillYouTubeChannel).toHaveBeenCalledWith(
      expect.objectContaining({ creatorId, platform: 'youtube', externalId: 'yt-channel-1' }),
    )
    await flushMicrotasks() // let the .then() handler execute for coverage

    // Second link for the same creator must not duplicate the platform entry.
    mockFetchSequence([{ body: fixtureTokenResponse() }, { body: fixtureChannelsResponse() }])
    await handleGoogleCallback({ code: 'abc', state: 's', stateCookie: 's', creatorId })
    const creatorAfter = await collections().creators.findOne({ _id: new ObjectId(creatorId) })
    expect(creatorAfter?.platforms.filter((p) => p === 'youtube')).toHaveLength(1)
  })

  it('rejects a partial scope grant and writes nothing', async () => {
    const { creatorId } = await seedCreator()
    const fetchMock = mockFetchSequence([
      { body: fixtureTokenResponse({ scope: GOOGLE_LINK_SCOPES[0] }) },
    ])

    await expect(
      handleGoogleCallback({ code: 'abc', state: 's', stateCookie: 's', creatorId }),
    ).rejects.toThrow(ScopeDeniedError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(backfillYouTubeChannel).not.toHaveBeenCalled()

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'youtube' })
    expect(doc).toBeNull()
  })

  it('re-link updates tokens in place — still exactly one doc, new decrypted values', async () => {
    const { creatorId } = await seedCreator()
    mockFetchSequence([
      {
        body: fixtureTokenResponse({
          access_token: 'first-access',
          refresh_token: 'first-refresh',
        }),
      },
      { body: fixtureChannelsResponse() },
    ])
    await handleGoogleCallback({ code: 'abc', state: 's', stateCookie: 's', creatorId })

    mockFetchSequence([
      {
        body: fixtureTokenResponse({
          access_token: 'second-access',
          refresh_token: 'second-refresh',
        }),
      },
      {
        body: fixtureChannelsResponse({
          items: [{ id: 'yt-channel-1', snippet: { title: 'Renamed' } }],
        }),
      },
    ])
    await handleGoogleCallback({ code: 'def', state: 's', stateCookie: 's', creatorId })

    const docs = await collections()
      .platformAccounts.find({ creatorId, platform: 'youtube' })
      .toArray()
    expect(docs).toHaveLength(1)
    expect(decryptToken(docs[0]!.accessToken)).toBe('second-access')
    expect(decryptToken(docs[0]!.refreshToken!)).toBe('second-refresh')
  })

  it('calls the token endpoint with a POST body containing client_secret, never in the URL', async () => {
    const { creatorId } = await seedCreator()
    const fetchMock = mockFetchSequence([
      { body: fixtureTokenResponse() },
      { body: fixtureChannelsResponse() },
    ])

    await handleGoogleCallback({ code: 'abc', state: 's', stateCookie: 's', creatorId })

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(tokenUrl)).toBe(GOOGLE_TOKEN_URL)
    expect(String(tokenUrl)).not.toContain(env.AUTH_GOOGLE_SECRET)
    expect(tokenInit.method).toBe('POST')
    expect(tokenInit.body).toBeInstanceOf(URLSearchParams)
    const bodyParams = tokenInit.body as URLSearchParams
    expect(bodyParams.get('grant_type')).toBe('authorization_code')
    expect(bodyParams.get('client_secret')).toBe(env.AUTH_GOOGLE_SECRET)
    expect(bodyParams.get('code')).toBe('abc')

    const [channelsUrl] = fetchMock.mock.calls[1] as [string]
    expect(String(channelsUrl)).toBe(YOUTUBE_CHANNELS_URL)
  })

  it('throws a typed error and writes nothing when the token endpoint responds non-OK', async () => {
    const { creatorId } = await seedCreator()
    mockFetchSequence([{ ok: false, status: 400, body: { error: 'invalid_grant' } }])

    await expect(
      handleGoogleCallback({ code: 'abc', state: 's', stateCookie: 's', creatorId }),
    ).rejects.toThrow(TokenExchangeError)
    expect(backfillYouTubeChannel).not.toHaveBeenCalled()

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'youtube' })
    expect(doc).toBeNull()
  })

  it('throws a typed error and writes nothing when the channels endpoint responds non-OK', async () => {
    const { creatorId } = await seedCreator()
    mockFetchSequence([{ body: fixtureTokenResponse() }, { ok: false, status: 500, body: {} }])

    await expect(
      handleGoogleCallback({ code: 'abc', state: 's', stateCookie: 's', creatorId }),
    ).rejects.toThrow(ChannelLookupError)
    expect(backfillYouTubeChannel).not.toHaveBeenCalled()

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'youtube' })
    expect(doc).toBeNull()
  })

  it('throws a typed error and writes nothing when the channels response has no items', async () => {
    const { creatorId } = await seedCreator()
    mockFetchSequence([
      { body: fixtureTokenResponse() },
      { body: fixtureChannelsResponse({ items: [] }) },
    ])

    await expect(
      handleGoogleCallback({ code: 'abc', state: 's', stateCookie: 's', creatorId }),
    ).rejects.toThrow(ChannelLookupError)
    expect(backfillYouTubeChannel).not.toHaveBeenCalled()

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'youtube' })
    expect(doc).toBeNull()
  })

  it('rejects a schema-violating token response and writes nothing', async () => {
    const { creatorId } = await seedCreator()
    mockFetchSequence([{ body: fixtureTokenResponse({ access_token: undefined }) }])

    await expect(
      handleGoogleCallback({ code: 'abc', state: 's', stateCookie: 's', creatorId }),
    ).rejects.toThrow()
    expect(backfillYouTubeChannel).not.toHaveBeenCalled()

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'youtube' })
    expect(doc).toBeNull()
  })

  it('rejects a schema-violating channels response and writes nothing', async () => {
    const { creatorId } = await seedCreator()
    mockFetchSequence([
      { body: fixtureTokenResponse() },
      { body: { items: [{ id: 'yt-channel-1' }] } },
    ])

    await expect(
      handleGoogleCallback({ code: 'abc', state: 's', stateCookie: 's', creatorId }),
    ).rejects.toThrow()
    expect(backfillYouTubeChannel).not.toHaveBeenCalled()

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'youtube' })
    expect(doc).toBeNull()
  })

  it('reports a backfill failure to Sentry without failing the link callback', async () => {
    const { creatorId } = await seedCreator()
    mockFetchSequence([{ body: fixtureTokenResponse() }, { body: fixtureChannelsResponse() }])
    vi.mocked(backfillYouTubeChannel).mockRejectedValueOnce(new Error('backfill boom'))

    await handleGoogleCallback({ code: 'abc', state: 's', stateCookie: 's', creatorId })
    await flushMicrotasks() // let the .catch() handler execute for coverage

    expect(backfillYouTubeChannel).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)

    const doc = await collections().platformAccounts.findOne({ creatorId, platform: 'youtube' })
    expect(doc).not.toBeNull()
  })

  it('does not overwrite a stored refreshToken/tokenExpiresAt when a re-consent omits them', async () => {
    const { creatorId } = await seedCreator()
    mockFetchSequence([{ body: fixtureTokenResponse() }, { body: fixtureChannelsResponse() }])
    await handleGoogleCallback({ code: 'abc', state: 's', stateCookie: 's', creatorId })
    const first = await collections().platformAccounts.findOne({ creatorId, platform: 'youtube' })

    mockFetchSequence([
      {
        body: fixtureTokenResponse({
          access_token: 'no-refresh-access',
          refresh_token: undefined,
          expires_in: undefined,
        }),
      },
      { body: fixtureChannelsResponse() },
    ])
    await handleGoogleCallback({ code: 'def', state: 's', stateCookie: 's', creatorId })

    const second = await collections().platformAccounts.findOne({ creatorId, platform: 'youtube' })
    expect(decryptToken(second!.accessToken)).toBe('no-refresh-access')
    expect(second!.refreshToken).toBe(first!.refreshToken)
    expect(second!.tokenExpiresAt).toEqual(first!.tokenExpiresAt)
  })
})
