# AMS

Athlete management system for athletic teams, tactical units and research studies:
people and groups with fine-grained permissions, a form builder for questionnaires, session
logs, tests and medical records, calculated metrics and readiness dashboards, CSV imports
from team systems, a staff web app and an athlete mobile app.

Wearable data (Garmin, Oura, Whoop, Polar, Apple Health, Health Connect, ...) comes from
[Open Wearables](https://github.com/dial203/open-wearables), which AMS uses as its
ingestion, storage and integration backend.

| | |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit, permissions, forms, wearables, metrics engine |
| [docs/API.md](docs/API.md) | API contract |
| [docs/FORMS.md](docs/FORMS.md) | Form schema and expression language |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What's built and what's next |

## Live demo

**[dial203.github.io/ams](https://dial203.github.io/ams/)**: the staff web app running entirely in
the browser on the API's synthetic `seed-demo` organization. Pick a role (owner, coach, medical,
blinded researcher, athlete) to see what that login sees. Nothing you enter leaves the tab: changes
reset on reload, and new entries do not recompute metrics.

The `Demo (GitHub Pages)` workflow rebuilds it on every push to `main`: the API seeds a throwaway
database and `export-demo` writes each role's real API responses to JSON, which an in-browser fake
API (`web/src/demo`) serves. To build it locally (needs an empty Postgres database):

```bash
DATABASE_URL=postgresql+psycopg://postgres@localhost:5432/ams_demo scripts/build-demo.sh
pnpm --filter @ams/web exec vite preview --base /ams/     # http://localhost:4173/ams/
```

## Layout

```
api/              FastAPI service + Celery worker (Python 3.13, uv)
web/              Staff web app (React, Vite, TanStack)
mobile/           Athlete app (Expo / React Native)
packages/shared/  @ams/shared: API client, types, form engine
spec/             Conformance vectors both form engines must pass
```

## Quickstart (local, without Docker)

Needs Python 3.13 + [uv](https://docs.astral.sh/uv/), Node 22 + pnpm 10, Postgres 16, Redis
(Redis only for the Celery worker).

```bash
# API on :8001
cd api && cp .env.example .env            # set DATABASE_URL and AMS_SECRET_KEY
uv sync && uv run alembic upgrade head
uv run python -m app.cli seed-demo        # demo org; logins printed (admin@example.com / demo-password-change-me)
uv run uvicorn app.main:app --port 8001

# Web on :5173
pnpm install
VITE_API_URL=http://localhost:8001 pnpm --filter @ams/web dev

# Mobile (Expo); see mobile/README.md for devices and the health-sync development build
EXPO_PUBLIC_API_URL=http://<lan-ip>:8001 pnpm --filter @ams/mobile start
```

## Run with Docker

```bash
cp .env.example .env        # set AMS_SECRET_KEY (openssl rand -hex 32) and AMS_DB_PASSWORD
docker compose up -d
```

The API and web images are built by GitHub Actions on every push to `main` and published as
`ghcr.io/dial203/ams-api` and `ghcr.io/dial203/ams-web`, so the server only pulls them. To build
from your checkout instead: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

Open http://localhost:3001. The web container serves the app and forwards `/api` to the API, so
one port serves everything (API docs at `/api/v1/docs`). Set `AMS_SEED_DEMO=true` for the demo
organization, or `AMS_ORG_NAME` + `AMS_ADMIN_EMAIL` + `AMS_ADMIN_PASSWORD` for your own; the API
applies them on start and only ever adds what is missing.

### Deploy with Portainer

**Stacks → Add stack → Repository**, repository `https://github.com/dial203/ams`, reference
`refs/heads/main`, compose path `docker-compose.yml`. Under **Environment variables** add the
settings from `.env.example`: at least `AMS_SECRET_KEY`, `AMS_DB_PASSWORD` and `AMS_PUBLIC_URL`
(the address people will open, e.g. `https://ams.example.org`), plus the first-start variables
above. Publish `AMS_WEB_PORT` (default 3001) through your reverse proxy. Portainer pulls the
published images (`pull_policy: always`) and builds nothing, which also avoids BuildKit errors on
agent-managed environments; to pick up a new version, use **Pull and redeploy** (or enable
GitOps updates). `AMS_DB_PASSWORD` only takes effect when the database volume is first created.

Wearables need a running [Open Wearables](https://github.com/dial203/open-wearables) instance:
set `OW_BASE_URL`, `OW_API_KEY`, and for phone health-store sync `OW_APP_ID` / `OW_APP_SECRET`,
then register an OW webhook pointing at `/api/v1/integrations/open-wearables/webhook` with its
secret in `OW_WEBHOOK_SECRET`. Without them the app runs and the wearable screens say they are
not set up.

## Checks

```bash
cd api && uv run ruff check . && uv run pytest -q     # TEST_DATABASE_URL, see api/README.md
pnpm -r typecheck && pnpm -r lint && pnpm -r test
pnpm --filter @ams/web test:e2e                       # against a seeded API on :8001
```
