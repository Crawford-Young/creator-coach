# Creator Coach

AI-powered creator coaching companion — multi-tenant Next.js application.

## Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS + dark mode (next-themes)
- **UI**: `@crawfordyoung/ui` via `@/lib/ui`
- **Database**: MongoDB Atlas + native `mongodb` driver v6 (no ODM — Zod validates documents)
- **Auth**: Auth.js v5 with Twitch OAuth (`@auth/mongodb-adapter`, database sessions)
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

## E2E pattern

Playwright boots the dev server through `tests/e2e/start-server.mjs`, which spins up an in-memory MongoDB (`mongodb-memory-server`, port 27097) and injects placeholder env vars — E2E never touches a real Atlas cluster and needs no real credentials. Specs authenticate by seeding a session document directly into the memory database (database session strategy), not by driving the Twitch OAuth flow.
