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

With Docker: `docker compose up -d` (see the header of `docker-compose.yml`).

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
