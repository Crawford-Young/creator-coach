import { spawn } from 'node:child_process'
import { MongoMemoryServer } from 'mongodb-memory-server'

const mongod = await MongoMemoryServer.create({ instance: { port: 27097 } })

// `src/env.ts` requires AUTH_TWITCH_ID/SECRET as non-empty — a checkout whose
// `.env` leaves them blank cannot boot the dev server. Explicit env set here
// beats `.env` in Next (same precedent as MONGODB_URI below), so this placeholder
// keeps E2E independent of real Twitch credentials — the service is not
// exercised by the seeded-session onboarding flow. The optional Sentry vars are
// NOT overridden: a placeholder DSN fails SDK parsing and spams "Invalid Sentry
// Dsn" on every run, while the real `.env` value no-ops in dev.
const dev = spawn('pnpm', ['dev'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    MONGODB_URI: 'mongodb://127.0.0.1:27097',
    MONGODB_DB: 'creator-coach-e2e',
    AUTH_TWITCH_ID: 'e2e-placeholder-client-id',
    AUTH_TWITCH_SECRET: 'e2e-placeholder-client-secret',
  },
})
dev.on('exit', (code) => {
  void mongod.stop().then(() => process.exit(code ?? 0))
})
