# @ams/web — AMS staff web app

Vite + React 19 + TypeScript, TanStack Router (file-based) and Query, Tailwind CSS v4,
shadcn/ui components (in `src/components/ui`), Recharts, dnd-kit. API calls, types, query
keys, the form engine and formatting all come from [`@ams/shared`](../packages/shared).

## Run

```bash
pnpm install                                         # repo root
VITE_API_URL=http://localhost:8001 pnpm --filter @ams/web dev     # http://localhost:5173
```

`VITE_API_URL` is the API origin (default `http://localhost:8001`); `/api/v1` is appended
unless already present. The API must allow the web origin in `CORS_ORIGINS`.

| Script | |
|---|---|
| `dev` / `build` / `preview` | Vite (build runs `tsc` first) |
| `dev:demo` / `build:demo` | The in-browser demo (below) |
| `typecheck` / `lint` | `tsc --noEmit`, ESLint |
| `test` | Vitest + Testing Library (jsdom) |
| `test:e2e` | Playwright against a running API with the demo seed (below) |
| `test:e2e-demo` | Playwright against the demo build (below) |

## Pages

| Route | |
|---|---|
| `/` | Readiness board: date, group filter, metric columns with flags (colour + shape + text), summary, sorting |
| `/athletes`, `/athletes/$id` | Search/filter, create; detail with trends (6 weeks, threshold bands), submissions (view/edit/delete), wearables (connect link + QR, refresh, daily data), profile + app invite |
| `/groups` | Hierarchy, create/edit/archive, members (add, remove with `left_on`), staff access (admin) |
| `/forms`, `/forms/$id` | List, new form, install template; builder with drag-and-drop outline, field editor, expression checking, live preview + test values, publish, settings, schedules, versions |
| `/entry` | Single entry (422/409 handling) and the team grid (keyboard + paste, live calculations, `submissions/bulk`) |
| `/data` | Submissions explorer with form columns, CSV export (de-identified option), import wizard, import history with rollback |
| `/metrics` | Definitions, editor (source, aggregation, transform params, thresholds), server-side preview |
| `/settings` | Organization (time zone, terminology, readiness metrics), members, invitations, Open Wearables, account |
| `/login`, `/accept-invite?token=` | Auth. Athletes signing in on the web get a pointer to the mobile app and their own submissions |

The group filter in the top bar is global (remembered per organization); the last
organization is remembered too. All "athlete"/"group" wording follows the organization's
terminology.

## Auth tokens

The access token is kept in memory and in `localStorage`; the refresh token in
`localStorage`. On a 401 the client calls `/auth/refresh` once (shared by concurrent
requests), stores the rotated pair and retries; a rejected refresh token signs out, a
network failure does not. **Known trade-off:** anything that can run script on the origin
can read both tokens. Replace the refresh token storage with an httpOnly, `SameSite`
cookie set by the API (and drop the access token from `localStorage`) before exposing the
app beyond a trusted network.

## Tests

```bash
pnpm --filter @ams/web test
```

Unit/component tests cover the auth refresh wiring, the form renderer against every
schema and case in `spec/form-cases.json`, the form builder (key rename rewriting
expressions, inline schema errors, drag-and-drop logic), the team grid (keyboard
navigation, paste, bulk payload, row errors), the import mapping step and the readiness
flags/summary/sorting.

### End-to-end

Needs Postgres and the API from `api/` with the demo seed:

```bash
cd api
export DATABASE_URL=postgresql+psycopg://postgres@localhost:5432/ams_web_e2e AMS_SECRET_KEY=$(openssl rand -hex 32)
export CORS_ORIGINS=http://localhost:5173
uv run alembic upgrade head && uv run python -m app.cli seed-demo
uv run uvicorn app.main:app --port 8001
# in another shell
pnpm --filter @ams/web test:e2e          # starts vite on :5173 unless E2E_BASE_URL is set
```

The suite logs in as `admin@example.com`, walks every page, enters team-grid data, runs an
import (and rolls it back), publishes a new form, and checks the de-identified researcher
view. It writes the screenshots in `e2e/screenshots/`.

## Demo build

`pnpm build:demo` (`vite build --mode demo`, or `VITE_DEMO=1`) builds a self-contained demo for
static hosting (GitHub Pages: [dial203.github.io/ams](https://dial203.github.io/ams/)). It needs the
fixtures in `public/demo/<role>.json` (git-ignored), written by the API from a `seed-demo` database:
`uv run python -m app.cli export-demo --out ../web/public/demo`, or all of it with
`scripts/build-demo.sh` from the repository root. `pnpm dev:demo` runs the same thing with hot reload.

In the demo build `main.tsx` loads `src/demo` (a dynamic import, absent from normal builds) and uses:

- a `fetch` that answers every `/api/v1` call the app makes from an in-memory copy of the logged-in
  role's fixture: reads with the API's filters and paging, writes applied in memory (forms and
  publishing with `validateSchema`, submissions with `validateSubmission`, 422/409 like the API, CSV
  export, CSV import preview/dry run/commit/rollback, groups, athletes, invitations, settings).
  Permissions come from the fixture (the API's own responses and rights per role). Metric series and
  readiness boards are the precomputed ones; new entries do not change them. XLSX import, accepting
  invitations and Open Wearables actions are refused with a clear message; any other endpoint answers
  501 `Not available in the demo` (and logs a console warning);
- every date in the fixture moved by (today − export day), so the data always ends this morning;
- hash routing and relative asset URLs, so one build works at a domain root or under a sub-path;
- a banner and a sign-in page with one button per role. A reload keeps the role and starts over.

`pnpm test:e2e-demo` (Playwright, `playwright.demo.config.ts`) clicks through the built demo as each
role, serving `dist` under `/ams/` and at `/`; it writes screenshots to `e2e-demo/screenshots/`.

## Docker

`docker compose up web` (repo root) builds `web/Dockerfile`: a static build served by
nginx with SPA fallback, which also forwards `/api/` to the `api` service. `VITE_API_URL` is a
build argument; its default `/` means "same origin" (`apiBaseUrl` turns it into `/api/v1`), so
the image needs no API address. Pass an absolute URL only when the API lives elsewhere.
