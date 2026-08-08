# Creator Coach

AI-powered creator coaching companion — multi-tenant Next.js application.

## Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS + dark mode (next-themes)
- **UI**: `@crawfordyoung/ui` via `@/lib/ui`
- **Database**: MongoDB Atlas + native driver
- **Auth**: Auth.js v5 with Twitch OAuth
- **Rate limiting**: Upstash Redis
- **Error monitoring**: Sentry
- **Testing**: Vitest + Playwright + MSW
- **Deployment**: Vercel

## Getting Started

1. Copy `.env.example` to `.env` and fill in values:
   - `MONGODB_URI` — Atlas connection string
   - `MONGODB_DB` — database name (defaults to `creator-coach`)
   - `AUTH_SECRET` — `openssl rand -base64 32`
   - `AUTH_TWITCH_ID` / `AUTH_TWITCH_SECRET` — Twitch OAuth app credentials
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — Upstash dashboard
   - `SENTRY_DSN` / `SENTRY_AUTH_TOKEN` — Sentry project
   - `NEXT_PUBLIC_APP_URL` — your app URL

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Run the development server:
   ```bash
   just dev
   ```

## Commands

| Command           | Description              |
| ----------------- | ------------------------ |
| `just dev`        | Start dev server         |
| `just test`       | Run Vitest with coverage |
| `just e2e`        | Run Playwright E2E tests |
| `just lint`       | ESLint + Prettier check  |
| `just typecheck`  | TypeScript type check    |
| `just check`      | Run all checks           |
| `just storybook`  | Start Storybook          |
| `just db-indexes` | Create MongoDB indexes   |
