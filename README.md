# Creator Coach

AI-powered creator coaching companion — multi-tenant Next.js application.

## Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS + dark mode (next-themes)
- **UI**: `@crawfordyoung/ui` via `@/lib/ui`
- **Database**: MongoDB Atlas + native `mongodb` driver v6 (no ODM — Zod validates documents)
- **Auth**: Auth.js v5 with Twitch OAuth (`@auth/mongodb-adapter`, database sessions)
- **Platform connectors**: Twitch Helix + YouTube Data/Analytics ingestion (see below)
- **Error monitoring**: Sentry
- **Testing**: Vitest + Playwright (E2E on `mongodb-memory-server`)
- **Deployment**: Vercel

## Getting Started

1. Copy `.env.example` to `.env` and fill in values:

   | Variable                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                           |
   | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `MONGODB_URI`                           | Atlas connection string. `mongodb+srv://` normally; if SRV DNS lookups fail on your machine (`querySrv ECONNREFUSED` — Node's resolver list contains a dead entry), use the seedlist form instead: `mongodb://user:pass@host1:27017,host2:27017,host3:27017/?tls=true&replicaSet=<rs>&authSource=admin&retryWrites=true&w=majority`. Find the replica-set name in the TXT record of the cluster host. Vercel uses the srv form. |
   | `MONGODB_DB`                            | Database name (defaults to `creator-coach`)                                                                                                                                                                                                                                                                                                                                                                                     |
   | `AUTH_SECRET`                           | `openssl rand -base64 32`                                                                                                                                                                                                                                                                                                                                                                                                       |
   | `AUTH_TWITCH_ID` / `AUTH_TWITCH_SECRET` | Twitch OAuth app credentials (redirect URL: `<origin>/api/auth/callback/twitch`)                                                                                                                                                                                                                                                                                                                                                |
   | `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google Cloud OAuth 2.0 Web client for the YouTube link flow (redirect URI: `<origin>/api/connections/google/callback`; enable YouTube Data API v3 + YouTube Analytics API)                                                                                                                                                                                                                                                      |
   | `TOKEN_ENC_KEY`                         | 32-byte base64 key encrypting platform tokens at rest — `openssl rand -base64 32`                                                                                                                                                                                                                                                                                                                                               |
   | `CRON_SECRET`                           | Bearer token guarding `/api/cron/*` — `openssl rand -base64 32`. Also a Vercel env var at deploy.                                                                                                                                                                                                                                                                              |
   | `SENTRY_DSN` / `SENTRY_AUTH_TOKEN`      | Optional — Sentry project                                                                                                                                                                                                                                                                                                                                                                                                       |
   | `NEXT_PUBLIC_APP_URL`                   | Your app URL                                                                                                                                                                                                                                                                                                                                                                                                                    |

   Blank lines in `.env` (`KEY=`) are treated as **unset**, not empty strings — env validation (`src/env.ts`) uses `emptyStringAsUndefined`, so optional vars can stay blank without failing startup.

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Create the unique indexes (once per database):

   ```bash
   just db-indexes
   ```

4. Run the development server:
   ```bash
   just dev
   ```

## Commands

| Command           | Description                                  |
| ----------------- | -------------------------------------------- |
| `just dev`        | Start dev server                             |
| `just test`       | Run Vitest with coverage                     |
| `just e2e`        | Run Playwright E2E tests                     |
| `just lint`       | ESLint + Prettier check                      |
| `just typecheck`  | TypeScript type check                        |
| `just check`      | Run all checks (lint, typecheck, test, e2e)  |
| `just db-indexes` | Create MongoDB unique indexes (reads `.env`) |

## Connector architecture (W1)

Platform data flows through a shared connector contract (`src/lib/connectors/types.ts`):

- **`PlatformConnector`** — `syncChannel` (channel-level metric snapshot), `syncContent` (upsert content items), `syncMetrics` (per-item metric snapshots). Implemented by `twitchConnector` (`src/lib/connectors/twitch.ts`) and `youtubeConnector` (`src/lib/connectors/youtube.ts`); `checkLive` (Twitch CCV) is a standalone export.
- **Tokens** are encrypted at rest (`src/lib/token-crypto.ts`, `v1:` AES-256-GCM format) and refreshed through `getFreshTwitchToken`/`getFreshGoogleToken` (`src/lib/connectors/token-refresh.ts`). A provider 401 forces one refresh-and-retry; a second 401 is a hard error. When the refresh grant itself is rejected, `ReauthRequiredError` flips the account to `reauth_required` and reports to Sentry — callers just skip the account.
- **Storage**: `contentItems` upserts on the unique `(platform, externalId)` index; `metricSnapshots` is a native MongoDB **time-series** collection (no upserts, no unique indexes possible) — idempotency is query-before-insert, owned by each writer.
- **YouTube backfill**: linking a Google account fires `backfillYouTubeChannel` (fire-and-forget from the OAuth callback) — full channel-history day series from the YouTube Analytics API, chunked 365 days per request, skipping days already present so re-linking never duplicates the series.

### Cron / live-poll ops

- **Daily ingest** — Vercel cron (`vercel.json`) hits `GET /api/cron/daily-ingest` at 06:00 UTC: every active account gets `syncChannel` + `syncContent` + `syncMetrics` (50 newest items). Accounts are isolated — one failure never blocks siblings; the route returns a per-account summary.
- **Live poll** — `GET /api/cron/live-poll`: Twitch accounts get a `checkLive` CCV snapshot while streaming. Currently has **no scheduler** — the GitHub Actions workflow that curled it every 10 minutes was removed 2026-08-21 (it had never run successfully: the `APP_URL` repo variable was never set, so every scheduled run failed before reaching the app). Trigger manually with `curl -H "Authorization: Bearer $CRON_SECRET" <app-url>/api/cron/live-poll`; the dashboard LIVE badge stays dormant until a scheduler is reinstated.
- Both routes require `Authorization: Bearer <CRON_SECRET>` (constant-time compare) and 401 otherwise.

### Weekly Google re-link ritual

The Google OAuth app runs in **Testing** status, so refresh tokens expire every 7 days. When YouTube sync starts failing with `reauth_required`, re-link via `/api/connections/google/start` — the backfill's skip-existing-days idempotency makes re-linking safe.

## E2E pattern

Playwright boots the dev server through `tests/e2e/start-server.mjs`, which spins up an in-memory MongoDB (`mongodb-memory-server`, port 27097) and injects placeholder env vars — E2E never touches a real Atlas cluster and needs no real credentials. Specs authenticate by seeding a session document directly into the memory database (database session strategy), not by driving the Twitch OAuth flow.
