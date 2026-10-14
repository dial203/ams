# Architecture

AMS is an athlete management system for athletic teams, tactical units and research
studies. It owns people, groups, permissions, forms (questionnaires, session logs, tests,
medical records), derived metrics and dashboards. **Open Wearables (OW)** owns everything
that comes from a wearable: provider OAuth, mobile health-store sync, ingestion,
normalization and raw storage.

```
                   ┌──────────────────────────── AMS ────────────────────────────┐
  Web (React) ───► │  AMS API (FastAPI)  ──►  Postgres (ams)                      │
  Mobile (Expo) ─► │     │   ▲                    people, groups, forms,          │
                   │     │   │ webhooks           submissions, metrics, audit     │
                   │     │   │                                                    │
                   │  Worker (Celery) ── Redis                                    │
                   └─────┼───┼──────────────────────────────────────────────────┘
                         │   │
            REST + API key   │ svix-signed webhooks
                         ▼   │
                   ┌──────── Open Wearables (dial203/open-wearables) ────────┐
                   │  provider OAuth, SDK ingest, summaries, timeseries      │
                   └─────────────────────────────────────────────────────────┘
                         ▲                         ▲
       Garmin/Oura/Whoop/Polar/... cloud APIs     Mobile app → OW SDK (HealthKit /
                                                   Health Connect) with an SDK token
                                                   the AMS API mints for the athlete
```

## Why two services

- OW stays a clean fork that can keep syncing with upstream. Nothing AMS-specific is
  added to it.
- OW's extension routes sit behind its server-to-server API key. Coaches and athletes
  need their own logins and fine-grained permissions regardless, so AMS has its own
  identity layer.
- Calculations (rolling loads, baselines, z-scores) live in Python next to the data
  model, with pandas available.

The cost: AMS reads wearable data over HTTP instead of SQL. AMS keeps a small
`wearable_daily` cache of the per-day values its dashboards need, refreshed on OW webhooks
and nightly, so dashboards never fan out to OW per request.

## Repository layout

| Path | What |
|---|---|
| `api/` | FastAPI service, SQLAlchemy 2.0, Alembic, Celery worker, pytest |
| `web/` | Staff web app: Vite + React 19 + TanStack Router/Query + Tailwind v4 + shadcn/ui |
| `mobile/` | Athlete app: Expo (React Native) + expo-router + TanStack Query + OW RN SDK |
| `packages/shared/` | `@ams/shared`: API types + client, form schema types, the expression language and form engine used by web and mobile |
| `spec/` | Cross-language conformance vectors. The Python and TypeScript implementations of the expression language and form engine must both pass every case |
| `docs/` | This file, [API.md](API.md) (contract), [FORMS.md](FORMS.md) (form schema + expressions), [ROADMAP.md](ROADMAP.md), `adr/` |

## Tenancy and people

Every domain table carries `org_id`. A deployment usually holds one organization, but
nothing assumes it (a department running several programs, or a lab running studies
for several partners, can share one deployment).

| Entity | Notes |
|---|---|
| `organization` | Settings include `timezone` and `terminology` (display labels: athlete → "Operator" / "Participant", group → "Unit" / "Cohort") |
| `user` | A login. Email + password. Staff and athletes are both users |
| `org_membership` | `user × org` with an org role: `owner`, `admin`, `staff`, `athlete` |
| `group` | Hierarchical (`parent_id`). `kind`: `team`, `squad`, `unit`, `section`, `study`, `cohort`, `other` |
| `athlete` | The person data is about. May exist without a login (`user_id` null). Has an org-unique `code` (e.g. `P-014`) used for de-identified views and imports. `ow_user_id` links to OW |
| `athlete_group` | Time-bounded membership (`joined_on`, `left_on`), so transfers and study withdrawal keep history |
| `staff_assignment` | `user × group` with an `access_role`, applies to the group and all descendants |

Internally the person is always `athlete`; the UI shows the org's terminology.

## Permissions

Org role sets the ceiling; staff are then scoped by group assignment and by form
sensitivity.

| Who | Athletes visible | Form data visible |
|---|---|---|
| `owner` / `admin` | all in org | all sensitivities, read/write |
| `staff` | athletes currently in an assigned group or its descendants | by `access_role` (below) |
| `athlete` | self only | own submissions of forms with `athlete_can_view` |

| `access_role` | `general` forms | `medical` forms | `research` forms | Write |
|---|---|---|---|---|
| `viewer` | read | – | – | no |
| `coach` | read | – | – | yes |
| `practitioner` | read | – | – | yes |
| `medical` | read | read | – | yes |
| `researcher` | read | – | read | yes |

A staff user's effective rights over an athlete are the union across every assignment
that covers that athlete. `staff_assignment.can_view_identifiable = false` masks names,
date of birth and email for that scope; such staff see `code` only (blinded assessors,
de-identified analysis). Exports honor the same mask.

Reads of `medical` and `research` form data and every write to athletes, forms and
submissions go to `audit_log`.

## Forms (the Smartabase "event form" model)

Everything that is not a wearable stream is a form submission: wellness questionnaires,
session RPE, injury reports, test batteries, GPS session summaries, force-plate results.
One model gives one place for permissions, imports, exports, history and calculations.

- `form`: metadata, `kind` (`questionnaire`, `session`, `test`, `medical`, `profile`,
  `import`), `sensitivity` (`general`, `medical`, `research`), `athlete_can_submit`,
  `athlete_can_view`, an editable `draft_schema`.
- `form_version`: immutable published schema. Every submission points at the version it
  was made with, so editing a form never rewrites history, which matters for research.
- `form_schedule`: which group is expected to complete a form, on which days, by when.
  Drives "due today" on mobile and reminder pushes.
- `submission`: `values` (what was entered), `computed` (calculated fields, computed
  server-side), `observed_at`, `local_date` (the athlete's calendar day the observation
  belongs to), `source` (`mobile`, `web`, `import`, `api`), soft delete.

The schema format and the expression language are specified in [FORMS.md](FORMS.md).
The TypeScript engine in `@ams/shared` gives instant feedback while typing (visibility,
calculated fields, validation); the Python engine in `api/` is authoritative and
recomputes on every write. Both pass `spec/*.json`.

## Wearables (via Open Wearables)

| Flow | How |
|---|---|
| Link | Creating the link makes an OW user with `external_user_id = <athlete uuid>`, stored as `athlete.ow_user_id` |
| Cloud providers (Garmin, Oura, Whoop, Polar, ...) | AMS asks OW `GET /api/v1/oauth/{provider}/authorize` for the athlete and returns the URL. Web shows it as a link/QR, mobile opens it in an auth session. `account_type` / `account_label` pass through for validation studies (e.g. two units worn at once) |
| Apple Health / Health Connect / Samsung | Mobile asks AMS for an SDK token; AMS calls OW `POST /api/v1/users/{ow_user_id}/token` with its OW app credentials and returns it. The OW React Native SDK in the app pushes health-store data straight to OW |
| New data | OW sends svix-signed webhooks (`sync.completed`, `connection.*`) to `POST /api/v1/integrations/open-wearables/webhook`. The worker refreshes that athlete's `wearable_daily` rows (the last 7 days). A nightly job does the same for every linked athlete as a safety net |
| History | The full window (`WEARABLE_HISTORY_DAYS`, default 365) is copied on an athlete's first sync, after a `sync.completed` whose source is `backfill` (Garmin history) or `xml_import` (Apple Health export), on the first sync after a new provider connection (`connection.created` clears `athlete.wearable_history_at`), by the nightly job when a provider was connected since the last copy, and on request ("Pull history" on the athlete's Wearables tab) |
| Deep data | Staff views that need raw timeseries or workouts proxy to OW on demand, they are not copied |

`wearable_daily` is long-format: `(athlete_id, local_date, metric, value, provider,
device)`, one row per provider. AMS requests OW summaries with `filter_by_priority=false`
(every source) and chooses the source itself, because OW's priority settings are global to
the OW deployment and need an OW developer login. Within a provider the device type decides
(chest strap, watch, band, ring, phone). Readers (metrics, the daily endpoint) then take, per
athlete, day and metric, the best-ranked provider that has a value: the athlete's ranking
(`athlete.wearable_priority`), else the organization's (`settings.wearable_priority`), then OW's
default order for providers neither lists. Changing a ranking needs no re-pull. A day that falls
to a lower-ranked provider carries that provider's source label, so same-source baselines skip it.
For method-comparison work, `GET .../wearables/daily?all_sources=true` returns every provider's
value; for raw data query OW directly (OW guide `docs/dev-guides/consuming-all-data.md`).

### Adding manufacturers

There are two kinds of source and they belong in different places:

1. **Per-athlete consumer wearables** (one account per person, OAuth or on-device health
   store): add the provider to OW following OW's
   `docs/dev-guides/how-to-add-new-provider.mdx`. AMS picks it up automatically through
   `GET /oauth/providers`, and its daily metrics flow through once mapped in
   `api/app/integrations/open_wearables/daily.py`.
2. **Team systems** (one org account, many athletes: GPS units, force plates, velocity
   transducers, team HR systems): these are AMS **connectors**. A connector maps the
   vendor's export or API to an AMS form (e.g. "GPS session", "CMJ test") and matches
   rows to athletes by `code`, email, name or a vendor athlete ID. The first connector is
   generic CSV/XLSX import with saved column mappings; vendor presets and API-pull
   connectors implement the same `Connector` interface in `api/app/connectors/`.

## Metrics engine (data manipulation)

A metric is a daily series per athlete, defined declaratively:

```
source      form:<form_slug>.<field_key> | wearable:<metric> | metric:<metric_slug>
daily_agg   sum | mean | last | max | min          (collapse a day's values to one)
transform   none | rolling_mean | rolling_sum | ewma | acwr | zscore | pct_change | monotony | strain
params      window, acute, chronic, baseline_days, min_periods, ln, method ...
thresholds  direction (high_bad | low_bad | both_bad), amber, red
```

Seeded definitions cover daily wellness total, sRPE load (Foster et al., 2001), acute and
chronic load, ACWR, training monotony and strain (Foster, 1998), and HRV (ln RMSSD 7-day
mean as a z-score against a rolling baseline; Plews et al., 2013). Every parameter is
editable per org.

Methodological guards built into the engine:

- **Baselines never mix sources.** A wearable-derived z-score uses only baseline days
  from the same provider/device as the day being scored. RMSSD from different devices
  is computed over different windows and is not interchangeable, so a device change
  restarts the baseline instead of producing a spurious deviation.
- **Missing days stay missing.** Rolling windows honor `min_periods`; a day with
  insufficient data yields null, never zero. Load metrics (`fill_zero`) count a day without
  a session as rest (0) only between an athlete's first and last logged session; days after
  the last one (an unlogged today) are unknown, so the morning board shows the last logged
  day's value with its date instead of a load that collapses until the session is entered.
- **ACWR ships with a caveat.** It is offered because practitioners ask for it, with
  EWMA and uncoupled variants, and its description notes the mathematical-coupling and
  ratio-scaling critiques (Lolli et al., 2019; Impellizzeri et al., 2020). Thresholds
  default to off for ACWR.

Metrics are computed on demand with pandas (a squad-season is tens of thousands of
points) and cached per `(metric, athlete, date range)` until a relevant submission or
wearable refresh invalidates it.

## Auth

Email + password (argon2id). Short-lived JWT access token + rotating refresh token
(stored hashed, revocable), same for web and mobile. Staff and athletes are onboarded
by invitation link. SSO (OIDC/SAML) is on the roadmap; tactical and university deployments
will need it.

## Deployment

`docker compose up` runs AMS (api, worker, beat, web, postgres, redis) alongside an
existing OW deployment. Configure `OW_BASE_URL`, `OW_API_KEY`, and for mobile health-store
sync `OW_APP_ID` / `OW_APP_SECRET`. AMS and OW should run in the same trust boundary;
OW holds raw health data and should not be exposed beyond what its provider callbacks
and SDK ingest need.

## References

- Foster C. (1998). Monitoring training in athletes with reference to overtraining syndrome. *Med Sci Sports Exerc* 30(7):1164–1168. https://doi.org/10.1097/00005768-199807000-00023
- Foster C. et al. (2001). A new approach to monitoring exercise training. *J Strength Cond Res* 15(1):109–115. https://pubmed.ncbi.nlm.nih.gov/11708692/
- Hooper S.L. & Mackinnon L.T. (1995). Monitoring overtraining in athletes. *Sports Med* 20(5):321–327. https://doi.org/10.2165/00007256-199520050-00003
- Plews D.J. et al. (2013). Training adaptation and heart rate variability in elite endurance athletes. *Sports Med* 43(9):773–781. https://doi.org/10.1007/s40279-013-0071-8
- Lolli L. et al. (2019). Mathematical coupling causes spurious correlation within the conventional acute-to-chronic workload ratio calculations. *Br J Sports Med* 53(15):921–922. https://doi.org/10.1136/bjsports-2017-098110
- Impellizzeri F.M. et al. (2020). Acute:chronic workload ratio: conceptual issues and fundamental pitfalls. *Int J Sports Physiol Perform* 15(6):907–913. https://doi.org/10.1123/ijspp.2019-0864
- Williams S. et al. (2017). Better way to determine the acute:chronic workload ratio? *Br J Sports Med* 51(3):209–210. https://doi.org/10.1136/bjsports-2016-096589
