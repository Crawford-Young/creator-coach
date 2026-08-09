import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const env = createEnv({
  server: {
    // Not .url(): multi-host seedlist URIs (mongodb://h1:p,h2:p,…) are legal
    // connection strings but fail WHATWG URL parsing.
    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// or mongodb+srv:// URI'),
    MONGODB_DB: z.string().min(1).default('creator-coach'),
    AUTH_SECRET: z.string().min(1),
    AUTH_TWITCH_ID: z.string().min(1),
    AUTH_TWITCH_SECRET: z.string().min(1),
    AUTH_GOOGLE_ID: z.string().min(1),
    AUTH_GOOGLE_SECRET: z.string().min(1),
    TOKEN_ENC_KEY: z.string().min(1),
    CRON_SECRET: z.string().min(1),
    // Production-only: a missing DSN makes Sentry a no-op locally, and the
    // auth token is only used for source-map upload at build time in CI.
    SENTRY_DSN: z.url().optional(),
    SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
  },
  runtimeEnv: {
    MONGODB_URI: process.env.MONGODB_URI,
    MONGODB_DB: process.env.MONGODB_DB,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_TWITCH_ID: process.env.AUTH_TWITCH_ID,
    AUTH_TWITCH_SECRET: process.env.AUTH_TWITCH_SECRET,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
    TOKEN_ENC_KEY: process.env.TOKEN_ENC_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
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
