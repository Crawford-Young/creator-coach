# CLAUDE.md — creator-coach

**Inherits:** `~/code/CLAUDE.md` → `~/code/web/CLAUDE.md`. This file records only repo-specific deviations and conventions.

## Stack deviation: MongoDB, not Neon/Drizzle

**User decision 2026-08-08** (spec: `~/code/docs/web/creator-coach/specs/2026-08-08-multiplatform-stats-dashboard-design.md`): this repo runs MongoDB Atlas with the native `mongodb` driver v6 — no Drizzle, no Neon, no Mongoose. Zod validates documents at boundaries. The web-domain "Neon + Drizzle" default does NOT apply here.

## Data layer conventions

- **`collections()` accessors** (`src/db/index.ts`): all collection access goes through the typed `collections()` factory — never `getDb().collection('...')` inline. New collections: add the `*Doc` interface + entry there.
- **`requireCreator` chokepoint** (`src/lib/tenant.ts`): every tenant-scoped server action/route resolves the creator via `requireCreator()` — identity comes from `auth()` inside it, never from parameters. Throws `UnauthorizedError` on no session or no tenant.
- **ObjectId hex-id contract**: `*Doc` types carry `_id: ObjectId`; public `Creator`/domain types carry `id: string` (`toHexString()`). Cross-document references (`PersonaProfileDoc.creatorId`) store the hex string, not an ObjectId. Convert at the `toCreator`-style mapper, nowhere else.
- **Unique indexes are code** (`scripts/db-indexes.mjs`, `ensureIndexes()`): `creators.userId` and `personaProfiles.creatorId` are unique. New unique constraints get added there and run via `just db-indexes` — Atlas is never hand-configured.

## Test conventions

- **Unit tests share one memory server, unique IDs per test**: suites connect to a shared `mongodb-memory-server` and isolate by generating fresh ObjectIds/userIds per test — never by wiping collections between tests (parallel files share the db).
- **E2E = seeded-session pattern**: `tests/e2e/start-server.mjs` boots a memory server (port 27097) and injects placeholder env (`MONGODB_URI`, `MONGODB_DB`, `AUTH_TWITCH_ID/SECRET`, **`AUTH_SECRET`** — CI has no `.env`, and Auth.js throws MissingSecret at runtime even under `SKIP_ENV_VALIDATION`; a var supplied only by local `.env` fails ONLY in CI). Specs authenticate by inserting a session document (database session strategy) — never by driving Twitch OAuth.
- **E2E vs real data**: an Atlas-connected dev server holding :3000 + `reuseExistingServer` means the e2e seed `wipe()` destroys real data. Kill the port holder before any e2e/gate battery.
- Coverage: branches threshold is **97** (rest 100) — `vitest.config.ts` is the authority.

## Auth lessons (bind W1 YouTube OAuth too)

- **OIDC scope override REPLACES defaults**: Twitch (and Google) providers are OIDC — setting `authorization.params.scope` replaces the default `openid ...` set. Omit `openid` and the provider returns no `id_token` → callback 500s. Any scope customization must re-include the provider's OIDC defaults.
- **CSP `form-action` governs the WHOLE redirect chain** of a form POST in Chrome, and the console error names the ORIGINAL action URL, not the violating hop. The sign-in form's chain crosses `id.twitch.tv`, `www.twitch.tv`, `auth.twitch.tv` — every host needs allow-listing in `next.config.ts`, or drive sign-in via `fetch` + `X-Auth-Return-Redirect: 1` + JS navigation (Auth.js client `signIn()` pattern), which `form-action` does not govern. `next.config.ts` is not hot-reloaded — restart the dev server after CSP edits.
- **No middleware**: `middleware.ts` was deleted in W0 — the mongodb driver cannot run on the edge runtime. Auth gating happens per-route via `requireCreator()`/`auth()`; do not reintroduce middleware for auth.

## Environment quirks

- `src/env.ts` validates `MONGODB_URI` with a scheme regex, not `.url()` — multi-host seedlist URIs are legal connection strings but fail WHATWG URL parsing.
- `emptyStringAsUndefined` is on: blank `.env` lines are unset, not empty strings.
- **This dev machine cannot resolve `mongodb+srv://`** (Node c-ares resolver has a dead `127.0.0.1` entry → `querySrv ECONNREFUSED`): local `.env` uses the seedlist URI form; Vercel gets the srv form.

## Scaffold status

- **Storybook removed in W0** (zero stories, preview build dead on SB8.6 + Next 15.5). W2 re-adds Storybook 9 with the first dashboard component — restore the `just storybook` recipe + DoD story requirement then.
- CI `pnpm audit` step runs `pnpm dlx pnpm@11 --pm-on-fail=ignore audit` with `continue-on-error: true` — remove the escape hatch in the dep-housekeeping PR (42 open vulns are all fix-by-major-bump).
