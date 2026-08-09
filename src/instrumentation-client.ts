import * as Sentry from '@sentry/nextjs'

// Next 16 builds with Turbopack, which does not run the webpack injection that
// loaded sentry.client.config.ts — instrumentation-client.ts is the only
// client-init path Next itself loads.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1,
  debug: false,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
