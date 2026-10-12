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
