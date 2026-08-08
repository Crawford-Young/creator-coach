import { spawn } from 'node:child_process'
import { MongoMemoryServer } from 'mongodb-memory-server'

const mongod = await MongoMemoryServer.create({ instance: { port: 27097 } })

// `src/env.ts` requires AUTH_TWITCH_ID/SECRET and UPSTASH_REDIS_REST_URL/TOKEN as
// non-empty — a checkout whose `.env` leaves them blank cannot boot the dev server.
// Explicit env set here beats `.env` in Next (same precedent as MONGODB_URI below),
// so these placeholders keep E2E independent of real Twitch/Upstash credentials —
// neither service is exercised by the seeded-session onboarding flow. The optional
// Sentry vars are NOT overridden: a placeholder DSN fails SDK parsing and spams
// "Invalid Sentry Dsn" on every run, while the real `.env` value no-ops in dev.
const dev = spawn('pnpm', ['dev'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    MONGODB_URI: 'mongodb://127.0.0.1:27097',
    MONGODB_DB: 'creator-coach-e2e',
    AUTH_TWITCH_ID: 'e2e-placeholder-client-id',
    AUTH_TWITCH_SECRET: 'e2e-placeholder-client-secret',
    UPSTASH_REDIS_REST_URL: 'https://e2e-placeholder.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'e2e-placeholder-token',
  },
})
dev.on('exit', (code) => {
  void mongod.stop().then(() => process.exit(code ?? 0))
})
