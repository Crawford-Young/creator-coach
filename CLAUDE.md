# CLAUDE.md — creator-coach

**Inherits:** `~/code/CLAUDE.md` → `~/code/web/CLAUDE.md`. This file records only repo-specific deviations and conventions.

## Stack deviation: MongoDB, not Neon/Drizzle

**User decision 2026-08-08** (spec: `~/code/docs/web/creator-coach/specs/2026-08-08-multiplatform-stats-dashboard-design.md`): this repo runs MongoDB Atlas with the native `mongodb` driver v6 — no Drizzle, no Neon, no Mongoose. Zod validates documents at boundaries. The web-domain "Neon + Drizzle" default does NOT apply here.

## Data layer conventions

- **`collections()` accessors** (`src/db/index.ts`): all collection access goes through the typed `collections()` factory — never `getDb().collection('...')` inline. New collections: add the `*Doc` interface + entry there.
- **`requireCreator` chokepoint** (`src/lib/tenant.ts`): every tenant-scoped server action/route resolves the creator via `requireCreator()` — identity comes from `auth()` inside it, never from parameters. Throws `UnauthorizedError` on no session or no tenant.
- **ObjectId hex-id contract**: `*Doc` types carry `_id: ObjectId`; public `Creator`/domain types carry `id: string` (`toHexString()`). Cross-document references (`PersonaProfileDoc.creatorId`) store the hex string, not an ObjectId. Convert at the `toCreator`-style mapper, nowhere else.
- **Unique indexes are code** (`scripts/db-indexes.mjs`, `ensureIndexes()`): `creators.userId` and `personaProfiles.creatorId` are unique. New unique constraints get added there and run via `just db-indexes` — Atlas is never hand-configured.

## Connector conventions (W1)

- **`PlatformConnector` contract** (`src/lib/connectors/types.ts`): `syncChannel`/`syncContent`/`syncMetrics(account, items)`. New platforms implement it and register in `run-daily.ts`'s `CONNECTORS` map; `checkLive` (Twitch) is a standalone export, not part of the contract.
- **`metricSnapshots` is a native time-series collection — NO upserts, NO unique indexes.** Write-path idempotency is query-before-insert, owned by each writer (backfill queries existing day keys; daily sync just inserts — a re-run within a day adds a second same-day snapshot by design). Never add an upsert or unique index against it; the driver/server will reject them.
- **Token discipline**: platform tokens are AES-256-GCM encrypted at rest (`src/lib/token-crypto.ts`, `v1:` prefix; un-prefixed values pass through as legacy). Connectors get plaintext tokens ONLY via `getFreshTwitchToken`/`getFreshGoogleToken(account, {forceRefresh?})` — in-memory, never persisted or logged (logger calls carry ids only). Provider 401 → one `forceRefresh` retry → second 401 is a hard error. `ReauthRequiredError` already flips account status + captures to Sentry at refresh time — callers catch it and continue, never re-capture.
- **External API responses are Zod-validated per item**: envelope failure = typed error; per-item failure = Sentry + skip, never abort the run. Any non-OK ≠401 response throws a TYPED error carrying the status — parsing a non-OK body as payload masks quota errors (T8 review Major).
- **Multi-id request params are chunked at the provider's page size** (Twitch `HELIX_PAGE_SIZE` 100, YouTube `YT_VIDEOS_BATCH_SIZE` 50) — unchunked >limit requests silently truncate (T7 review Major).
- **Cron surfaces**: `/api/cron/daily-ingest` (Vercel cron, `vercel.json`) and `/api/cron/live-poll` (GitHub Actions curl every 10 min, `.github/workflows/live-poll.yml`). Both guarded by `Authorization: Bearer <CRON_SECRET>` with a constant-time compare (sha256 digests + `timingSafeEqual`). Routes stay thin — logic lives in `src/lib/ingest/`.

## Test conventions

- **Unit tests share one memory server, unique IDs per test**: suites connect to a shared `mongodb-memory-server` and isolate by generating fresh ObjectIds/userIds per test — never by wiping collections between tests (parallel files share the db).
- **`tests/globalSetup.ts` pre-creates `metricSnapshots` as a time-series collection before any worker runs.** An insert into a not-yet-created collection auto-creates it PLAIN, and vitest's parallel workers have no file order — per-suite `ensureTimeseries()` guards cannot fix this race (W1 issue #5). New time-series collections get the same globalSetup pre-create.
- **E2E = seeded-session pattern**: `tests/e2e/start-server.mjs` boots a memory server (port 27097) and injects placeholder env (`MONGODB_URI`, `MONGODB_DB`, `AUTH_TWITCH_ID/SECRET`, **`AUTH_SECRET`** — CI has no `.env`, and Auth.js throws MissingSecret at runtime even under `SKIP_ENV_VALIDATION`; a var supplied only by local `.env` fails ONLY in CI). Specs authenticate by inserting a session document (database session strategy) — never by driving Twitch OAuth.
- **E2E vs real data**: an Atlas-connected dev server holding :3000 + `reuseExistingServer` means the e2e seed `wipe()` destroys real data. Kill the port holder before any e2e/gate battery.
- Coverage: branches threshold is **97** (rest 100) — `vitest.config.ts` is the authority.

## Auth lessons (bind W1 YouTube OAuth too)

- **OIDC scope override REPLACES defaults**: Twitch (and Google) providers are OIDC — setting `authorization.params.scope` replaces the default `openid ...` set. Omit `openid` and the provider returns no `id_token` → callback 500s. Any scope customization must re-include the provider's OIDC defaults.
- **CSP `form-action` governs the WHOLE redirect chain** of a form POST in Chrome, and the console error names the ORIGINAL action URL, not the violating hop. The sign-in form's chain crosses `id.twitch.tv`, `www.twitch.tv`, `auth.twitch.tv` — every host needs allow-listing in `next.config.ts`, or drive sign-in via `fetch` + `X-Auth-Return-Redirect: 1` + JS navigation (Auth.js client `signIn()` pattern), which `form-action` does not govern. `next.config.ts` is not hot-reloaded — restart the dev server after CSP edits. **Doc-vs-config parity:** this bullet and `next.config.ts` `form-action` must list the SAME hosts — W1 shipped with the doc at 3 hosts and the config at 2 because nothing gated the divergence (auth.twitch.tv only appears on new-scope consent, so already-authorized sign-ins passed); when either side changes, update the other in the same edit and curl-verify the served header.
- **No middleware**: `middleware.ts` was deleted in W0 — the mongodb driver cannot run on the edge runtime. Auth gating happens per-route via `requireCreator()`/`auth()`; do not reintroduce middleware for auth.

## Environment quirks

- `src/env.ts` validates `MONGODB_URI` with a scheme regex, not `.url()` — multi-host seedlist URIs are legal connection strings but fail WHATWG URL parsing.
- `emptyStringAsUndefined` is on: blank `.env` lines are unset, not empty strings.
- **This dev machine cannot resolve `mongodb+srv://`** (Node c-ares resolver has a dead `127.0.0.1` entry → `querySrv ECONNREFUSED`): local `.env` uses the seedlist URI form; Vercel gets the srv form.

## Scaffold status

- **Storybook removed in W0** (zero stories, preview build dead on SB8.6 + Next 15.5). W2 re-adds Storybook 9 with the first dashboard component — restore the `just storybook` recipe + DoD story requirement then.
- CI `pnpm audit --audit-level=high` is blocking (escape hatch removed in the dep-housekeeping wave, 2026-08-09). Transitive pins live in `pnpm-workspace.yaml` `overrides` (pnpm 11 dropped the package.json `pnpm` field) — currently `fast-uri: 3.1.5` via the sentry→webpack chain; drop when the chain floors it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
