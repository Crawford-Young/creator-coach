// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from 'mongodb'
import { collections, type PlatformAccountDoc } from '@/db'
import { encryptToken } from '@/lib/token-crypto'
import { logger } from '@/lib/logger'
import { env } from '@/env'

vi.mock('@/lib/connectors/twitch', () => ({
  twitchConnector: {
    syncChannel: vi.fn(),
    syncContent: vi.fn(),
    syncMetrics: vi.fn(),
  },
  checkLive: vi.fn(),
}))
vi.mock('@/lib/connectors/youtube', () => ({
  youtubeConnector: {
    syncChannel: vi.fn(),
    syncContent: vi.fn(),
    syncMetrics: vi.fn(),
  },
}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { checkLive } from '@/lib/connectors/twitch'
import { ReauthRequiredError } from '@/lib/connectors/token-refresh'
import { runLivePoll } from '@/lib/ingest/run-live-poll'
import { GET as livePollGET } from '@/app/api/cron/live-poll/route'

function uniqueId(label: string): string {
  return `${label}-${new ObjectId().toHexString()}`
}

// Same rationale as run-daily.test.ts: runLivePoll queries ALL status:'active'
// twitch platformAccounts globally, with no per-account identifier in the
// summary to filter leftover accounts by. Track and delete only what this
// file's own tests created — never a blanket wipe.
const createdAccountIds: ObjectId[] = []

async function seedAccount(
  overrides: Partial<PlatformAccountDoc> = {},
): Promise<PlatformAccountDoc> {
  const doc: PlatformAccountDoc = {
    _id: new ObjectId(),
    creatorId: new ObjectId().toHexString(),
    platform: 'twitch',
    externalId: uniqueId('ext'),
    handle: 'Streamer',
    accessToken: encryptToken('current-access-token'),
    refreshToken: encryptToken('current-refresh-token'),
    tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
    scopes: [],
    status: 'active',
    linkedAt: new Date(),
    ...overrides,
  }
  await collections().platformAccounts.insertOne(doc)
  createdAccountIds.push(doc._id)
  return doc
}

afterEach(async () => {
  vi.mocked(checkLive).mockReset()
  vi.mocked(Sentry.captureException).mockClear()
  vi.restoreAllMocks()
  if (createdAccountIds.length > 0) {
    await collections().platformAccounts.deleteMany({ _id: { $in: createdAccountIds } })
    createdAccountIds.length = 0
  }
})

describe('runLivePoll', () => {
  it('polls active twitch accounts by identity; a non-active twitch account is untouched', async () => {
    // NOT toHaveBeenCalledTimes/exact summary equality: runLivePoll scans
    // ALL status:'active' twitch accounts globally, and this repo's
    // shared-memory-server convention never wipes other test files'
    // leftover 'active' fixtures — identity-scoped assertions are the
    // reliable check here (same rationale as run-daily.test.ts).
    const activeTwitch = await seedAccount({ platform: 'twitch', status: 'active' })
    const inactiveTwitch = await seedAccount({ platform: 'twitch', status: 'reauth_required' })

    await runLivePoll()

    expect(checkLive).toHaveBeenCalledWith(expect.objectContaining({ _id: activeTwitch._id }))
    expect(checkLive).not.toHaveBeenCalledWith(expect.objectContaining({ _id: inactiveTwitch._id }))
  })

  it('one account throwing does not stop siblings', async () => {
    const failing = await seedAccount({ platform: 'twitch' })
    const ok = await seedAccount({ platform: 'twitch' })
    vi.mocked(checkLive).mockImplementationOnce(async () => {
      throw new Error('stream check failed')
    })

    const summary = await runLivePoll()

    expect(checkLive).toHaveBeenCalledWith(expect.objectContaining({ _id: ok._id }))
    // ok:false rows are exact regardless of shared-DB noise: only THIS
    // test's own mockImplementationOnce produces a failure.
    const errorRows = summary.filter((row) => !row.ok)
    expect(errorRows).toEqual([{ platform: 'twitch', ok: false, error: 'stream check failed' }])
    void failing
  })

  it('a ReauthRequiredError account is skipped without re-reporting to Sentry or logger.error', async () => {
    const account = await seedAccount({ platform: 'twitch' })
    const sentrySpy = vi.mocked(Sentry.captureException)
    const loggerErrorSpy = vi.spyOn(logger, 'error')
    vi.mocked(checkLive).mockImplementationOnce(async () => {
      throw new ReauthRequiredError(account.creatorId, 'twitch')
    })

    const summary = await runLivePoll()

    const errorRows = summary.filter((row) => !row.ok)
    expect(errorRows).toEqual([{ platform: 'twitch', ok: false, error: 'reauth_required' }])
    // Sentry/logger mocks are per-test-file module instances (vitest
    // isolates module registries per file) — safe to assert "not called"
    // exactly even though the DB itself is shared.
    expect(sentrySpy).not.toHaveBeenCalled()
    expect(loggerErrorSpy).not.toHaveBeenCalled()
  })

  it('a non-reauth error is reported to Sentry and logger.error', async () => {
    const account = await seedAccount({ platform: 'twitch' })
    const sentrySpy = vi.mocked(Sentry.captureException)
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never)
    const boom = new Error('boom')
    vi.mocked(checkLive).mockImplementationOnce(async () => {
      throw boom
    })

    const summary = await runLivePoll()

    expect(sentrySpy).toHaveBeenCalledWith(boom)
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
    const errorRows = summary.filter((row) => !row.ok)
    expect(errorRows).toEqual([{ platform: 'twitch', ok: false, error: 'boom' }])
    void account
  })

  it('does not poll a non-active twitch account', async () => {
    const account = await seedAccount({ platform: 'twitch', status: 'reauth_required' })

    await runLivePoll()

    expect(checkLive).not.toHaveBeenCalledWith(expect.objectContaining({ _id: account._id }))
  })

  it('does not poll a youtube account, even if active', async () => {
    const youtubeAccount = await seedAccount({ platform: 'youtube', status: 'active' })

    await runLivePoll()

    expect(checkLive).not.toHaveBeenCalledWith(expect.objectContaining({ _id: youtubeAccount._id }))
  })
})

describe('GET /api/cron/live-poll', () => {
  it('returns 401 for a wrong secret', async () => {
    const request = new Request('http://localhost/api/cron/live-poll', {
      headers: { Authorization: 'Bearer wrong-secret' },
    })
    const response = await livePollGET(request)
    expect(response.status).toBe(401)
  })

  it('returns 200 with the poll summary for a valid secret', async () => {
    const account = await seedAccount({ platform: 'twitch' })
    const request = new Request('http://localhost/api/cron/live-poll', {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    })

    const response = await livePollGET(request)

    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<{ platform: string; ok: boolean }>
    expect(body).toEqual(expect.arrayContaining([{ platform: 'twitch', ok: true }]))
    void account
  })
})
