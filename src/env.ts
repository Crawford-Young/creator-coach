import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const env = createEnv({
  server: {
    MONGODB_URI: z.string().url(),
    MONGODB_DB: z.string().min(1).default('creator-coach'),
    AUTH_SECRET: z.string().min(1),
    AUTH_TWITCH_ID: z.string().min(1),
    AUTH_TWITCH_SECRET: z.string().min(1),
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
    // Production-only: a missing DSN makes Sentry a no-op locally, and the
    // auth token is only used for source-map upload at build time in CI.
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
  },
  runtimeEnv: {
    MONGODB_URI: process.env.MONGODB_URI,
    MONGODB_DB: process.env.MONGODB_DB,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_TWITCH_ID: process.env.AUTH_TWITCH_ID,
    AUTH_TWITCH_SECRET: process.env.AUTH_TWITCH_SECRET,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  // A present-but-empty line in .env (e.g. `SENTRY_AUTH_TOKEN=`) must behave as
  // unset — otherwise optional vars fail their .min(1)/.url() checks on "".
  emptyStringAsUndefined: true,
})
