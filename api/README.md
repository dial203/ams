# AMS API

FastAPI service + Celery worker for AMS. The contract is [`docs/API.md`](../docs/API.md); the form
schema, expression language and evaluation are [`docs/FORMS.md`](../docs/FORMS.md) (normative).
OpenAPI is served at `/api/v1/openapi.json`, interactive docs at `/api/v1/docs`, health at `/health`.

## Layout

```
app/main.py            FastAPI app, routers, error handlers (OW -> 502 / 503)
app/config.py          settings from the environment (.env.example)
app/database.py        engine, sessions, declarative base
app/deps.py            auth + org membership dependencies (Principal)
app/permissions.py     the one place that decides visibility, sensitivity tiers, masking, write rights
app/audit.py           audit_log writes
app/models/            SQLAlchemy models
app/schemas/           pydantic models mirroring the API.md types
app/routes/            one module per area
app/services/          business logic (auth, people, forms, submissions, imports, wearables, metrics, reminders)
app/forms/             expression language, schema validation, evaluate/validate (pure Python)
app/metrics/           pandas transforms, engine, built-in metric definitions
app/integrations/open_wearables/   httpx client, daily mapping, svix webhook verification
app/connectors/        Connector protocol + CSV/XLSX import (vendor presets plug in here)
app/templates/         built-in form templates
app/worker.py, app/tasks.py        Celery app, beat schedule and tasks
app/cli.py, app/seed.py            operator CLI and the demo seed
migrations/            Alembic
tests/                 pytest (Postgres required)
```

## Run locally

Needs Python 3.13, [uv](https://docs.astral.sh/uv/), Postgres 14+ and (for the worker) Redis.

```bash
cd api
uv sync
cp .env.example .env            # set DATABASE_URL and AMS_SECRET_KEY at least
uv run alembic upgrade head
uv run python -m app.cli seed-demo                 # optional demo org; --password or AMS_DEMO_PASSWORD
uv run uvicorn app.main:app --reload --port 8001
uv run celery -A app.worker worker --loglevel=INFO
uv run celery -A app.worker beat --loglevel=INFO
```

Demo logins (password `demo-password-change-me` unless overridden): `admin@example.com` (owner),
`coach@example.com` (coach on Athletics), `medic@example.com` (medical on Athletics),
`researcher@example.com` (researcher on Pilot Study, de-identified), `athlete@example.com`
(athlete A-0001). The seed refuses to run when the demo org already exists.

Other CLI commands:

```bash
uv run python -m app.cli create-org --name "Unit 7" --timezone Europe/Berlin    # prints id and slug
uv run python -m app.cli create-admin --email boss@example.com --org unit-7      # owner if none yet, else admin
uv run python -m app.cli create-user --email coach@example.com --org unit-7 --role staff
uv run python -m app.cli export-demo --out ../web/public/demo                     # web demo fixtures (after seed-demo)
```

## Tests

Tests need a Postgres database they may wipe; the schema is rebuilt with `alembic upgrade head` at the
start of the session and every table is truncated after each test. Redis is not needed (Celery runs
eagerly, Open Wearables and Expo are mocked with respx).

```bash
export TEST_DATABASE_URL=postgresql+psycopg://postgres@localhost:5433/ams_test   # the default
uv run ruff check . && uv run ruff format --check . && uv run pytest -q
```

The migration test also creates and drops a scratch database, so the test role needs `CREATEDB`.

A throwaway Postgres without Docker (as root, `initdb` must run as a non-root user):

```bash
mkdir -p /tmp/ams-api-pg && chown postgres:postgres /tmp/ams-api-pg
runuser -u postgres -- /usr/lib/postgresql/16/bin/initdb -D /tmp/ams-api-pg/pgdata -U postgres \
    --auth=trust -E UTF8 --locale=C.UTF-8          # UTF8 matters: SQL_ASCII makes psycopg return bytes
runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/ams-api-pg/pgdata \
    -o "-p 5433 -k /tmp/ams-api-pg -c listen_addresses=localhost" -l /tmp/ams-api-pg/pg.log -w start
/usr/lib/postgresql/16/bin/createdb -h localhost -p 5433 -U postgres ams_test
```

## Docker

`Dockerfile` builds one image (python:3.13-slim + uv). The default command runs
`alembic upgrade head` and then uvicorn on port 8000; run the worker with
`celery -A app.worker worker --loglevel=INFO` and beat with
`celery -A app.worker beat --loglevel=INFO --schedule /tmp/celerybeat-schedule`.
Uploads go to `/data/uploads` (mount a volume shared by the api container).

## Design notes

**Permissions** (`app/permissions.py`): owner/admin see everything. Staff see athletes *currently*
(joined_on <= today < left_on) in an assigned group or its descendants; rights over an athlete are the
union over covering assignments. Readable sensitivities come from the access role (viewer/coach/
practitioner: general; medical: + medical; researcher: + research); writing form data needs a write
role (everything but viewer) whose sensitivities include the form's. `can_view_identifiable` is also a
union. Masked athletes have null names/email/date of birth, `display_name = code`, are not matched by
name/email in search or imports, and exports drop the name column. Athletes see themselves and forms
with `athlete_can_view` / `athlete_can_submit`. Anything invisible (athlete, form, submission, other
org) is 404; visible but not allowed is 403.

**Forms engine** (`app/forms/`) implements FORMS.md literally and passes all of `spec/*.json`; where
the spec is silent it matches `@ams/shared` (left-to-right summation, `-0` normalised, NaN/Infinity
are `invalid_type`, optional schema keys validated when present, one error per path).

**Metrics** (`app/metrics/`):

* Base series per athlete and calendar day. Form sources take the field from `values` or `computed`
  (booleans count 1/0) and collapse a day with `daily_agg` (`last` = latest `observed_at`).
  Wearable sources take one value per day and keep `provider/device` as that day's source label.
* `fill_zero` fills days without data with 0 only from the athlete's first observation onwards.
* `ewma` and `acwr` (EWMA) use the full history (EWMA seeded with the first observation, days
  without data skipped). Uncoupled EWMA ACWR divides today's acute EWMA by the chronic EWMA as it
  stood `acute` days ago (the day before the acute window); uncoupled rolling ACWR uses the
  `chronic - acute` days before the acute window. ACWR needs `chronic` observed days.
* `zscore`/`pct_change` baselines and the `smooth` window use only days whose source equals the
  scored day's source; the scored day must have a value. SD is the sample SD (ddof=1); SD 0 -> null.
* `monotony` = mean / sample SD over the window (null when SD = 0); `strain` = window sum x monotony.
* Points are rounded to `decimals` (half away from zero) before flags are applied.
* Built-ins (see `app/metrics/builtins.py` for threshold rationale) are seeded on org creation and
  resolve to empty series until their template forms are installed.

**Open Wearables** (`app/integrations/open_wearables/`): daily summaries are fetched with OW's default
`filter_by_priority=true`. Weight/body fat come from `/timeseries` (OW's `/summaries/body` has no
measurement dates). OW recovery summaries exist only for WHOOP today, so `hrv_rmssd_ms` /
`resting_hr_bpm` fall back to the nightly values in the sleep summary of the same day and source.
A refresh replaces the athlete's rows in the refreshed window (upsert, then drop rows OW no longer
returns). Linking looks the athlete up by `external_user_id` first; OW rejects duplicate emails (409),
in which case the OW user is created without an email.

## Known gaps

* Metric results are computed per request (fast enough for a squad-season); there is no cache yet.
* Email delivery is not implemented: invitation links are logged.
* Refresh-token reuse detection has no grace window for concurrent refreshes of the same token.
