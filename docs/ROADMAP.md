# Roadmap

Phase 1 is the vertical slice in this repo. Later phases are ordered by what a
department or lab hits first in day-to-day use.

## Phase 1: foundation (this slice)

- [x] Architecture, API contract, form/expression spec, cross-language conformance vectors
- [x] API: auth (email/password, JWT + rotating refresh), orgs, members, invitations
- [x] API: groups (hierarchical), athletes (coded IDs, PII masking), staff assignments, permission model
- [x] API: form builder backend: drafts, immutable versions, schema validation, templates (Hooper wellness, sRPE, injury, CMJ, GPS session, body mass)
- [x] API: submissions (single, bulk team entry), server-side calculation, soft delete, audit log, CSV export (de-identified option)
- [x] API: CSV/XLSX import with column mapping and athlete matching
- [x] API: Open Wearables link, provider connect URLs, SDK token minting, webhook receiver, `wearable_daily` cache
- [x] API: metrics engine (rolling, EWMA, uncoupled ACWR, z-score vs same-source baseline, monotony, strain), readiness board
- [x] `@ams/shared`: types, API client, expression language + form engine (passes `spec/`)
- [x] Web: readiness board, athletes, groups, form builder with live preview, data entry (single + team grid), data explorer + export + import wizard, metrics, settings
- [x] Mobile: login/invite, today's questionnaires, form renderer, history/trends, wearable connect (cloud OAuth + HealthKit/Health Connect via OW SDK), push token registration
- [x] docker-compose for local dev, CI (lint, typecheck, tests, spec conformance)

Known gaps in the slice:

- Invitation emails are not sent; the invite link is logged and shown in the web app to copy.
- Apple Health / Health Connect sync is wired through an adapter but has not run on a device:
  the Open Wearables React Native SDK is not on npm yet (see `mobile/README.md`).
- The Docker images have not been built end to end in the environment this was written in (its proxy blocks package downloads inside builds); the compose file, the nginx `/api` proxy and the first-start bootstrap were each tested separately.
- Web keeps the refresh token in `localStorage`; move it to an httpOnly cookie before
  production use with medical data.
- No athlete-facing endpoint to disconnect a cloud wearable; `ImportBatch` has no status, so
  rolled-back imports disappear from the list.
- Metric series are computed per request (fast at squad scale); add caching before
  department-wide dashboards.

## Phase 2: daily operations

- Staff alerts on red flags; verify due-questionnaire push reminders (implemented in the worker) on real devices
- Offline questionnaire completion on mobile with queued sync
- Calendar: sessions, games/missions, testing days; link sRPE submissions to calendar events
- Staff mobile mode: team RPE grid on a tablet at the end of a session
- Body map field type for injury/soreness location
- Per-form access-control overrides (beyond sensitivity tiers), field-level hiding
- Notes and file attachments on athletes (S3-compatible storage)
- Dashboard builder: saved boards with chosen metrics/groups, athlete profile report

## Phase 3: research and tactical

- Studies: protocols with scheduled timepoints, consent records (version, signed date, document), withdrawal handling
- De-identified data exports with stable study-specific pseudonyms; data dictionary export generated from form versions
- Blinded-assessor workflows (code-only views enforced end to end)
- Chain-of-command readiness roll-ups for units (aggregate-only views above a level)
- SSO (OIDC/SAML), MFA, session policies, IP allow-lists
- Data retention rules per form; right-to-erasure tooling

## Phase 4: integrations and analysis

- Vendor connectors on the `Connector` interface: GPS/LPS, force plates, velocity transducers, team HR systems (API pull where vendors allow, saved CSV presets otherwise)
- Validation/agreement module: pick two sources for a metric and get Bland–Altman (bias, LoA, proportional bias), CCC, MAE/RMSE, equivalence tests, using OW's all-sources view
- Smallest worthwhile change and typical error per metric from reliability data; flags based on SWC/TE rather than fixed thresholds
- Notebook/export bridge (parquet, R/Python client)
- Public API keys and outgoing webhooks for other systems
