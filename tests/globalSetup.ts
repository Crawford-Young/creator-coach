import { resolve } from 'path'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

let mongod: MongoMemoryServer | undefined

/** Placeholder values used only in tests for vars that have no real value in .env */
const TEST_ENV_DEFAULTS: Record<string, string> = {
  AUTH_SECRET: 'test-secret-for-unit-tests-only',
  AUTH_TWITCH_ID: 'test-twitch-id',
  AUTH_TWITCH_SECRET: 'test-twitch-secret',
  AUTH_GOOGLE_ID: 'test-google-id',
  AUTH_GOOGLE_SECRET: 'test-google-secret',
  TOKEN_ENC_KEY: Buffer.alloc(32, 2).toString('base64'),
  CRON_SECRET: 'test-cron-secret',
  SENTRY_DSN: 'https://test@o0.ingest.sentry.io/0',
  SENTRY_AUTH_TOKEN: 'test-sentry-auth-token',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
}

export async function setup(): Promise<void> {
  // Load .env file into process.env before tests run.
  // process.loadEnvFile is available in Node 20.12+.
  // This ensures real credentials (MONGODB_URI etc.) are present for
  // infrastructure tests that run in the node environment.
  const envPath = resolve(process.cwd(), '.env')
  try {
    process.loadEnvFile(envPath)
  } catch {
    // .env may not exist in CI — env vars must be injected by the CI runner
  }

  // Fill in any vars that are still missing/empty after .env load.
  // These placeholders are sufficient for unit tests that validate module
  // shape — they do not make real network requests.
  for (const [key, fallback] of Object.entries(TEST_ENV_DEFAULTS)) {
    if (!process.env[key]) {
      process.env[key] = fallback
    }
  }

  // Start an in-memory MongoDB instance for infrastructure tests that talk
  // to a real database. Overrides any MONGODB_URI/MONGODB_DB loaded above.
  mongod = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongod.getUri()
  process.env.MONGODB_DB = 'creator-coach-test'

  // Pre-create metricSnapshots as a native time-series collection BEFORE any
  // test worker runs. Vitest runs test files in parallel workers with no
  // guaranteed order; an insert into a not-yet-created collection auto-creates
  // it as a PLAIN collection, which silently breaks db-model.test.ts's
  // time-series assertions depending on scheduling. Creating it here — once,
  // before all workers — removes the race for every suite.
  const client = new MongoClient(process.env.MONGODB_URI)
  try {
    await client.db(process.env.MONGODB_DB).createCollection('metricSnapshots', {
      timeseries: {
        timeField: 'capturedAt',
        metaField: 'meta',
        granularity: 'hours',
      },
    })
  } finally {
    await client.close()
  }
}

export async function teardown(): Promise<void> {
  await mongod?.stop()
}
