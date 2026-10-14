# API contract (v1)

Contract between `api/` and its clients (`packages/shared`, `web/`, `mobile/`). The
running service's OpenAPI document at `/api/v1/openapi.json` is generated from the code;
this file is the design source both sides build against. Change it in the same PR as
the code.

## Conventions

- Base path `/api/v1`. JSON, `snake_case` keys. UUIDs as strings. Timestamps ISO 8601
  with offset (`2026-10-12T06:31:00Z`). Calendar days `YYYY-MM-DD`.
- Auth: `Authorization: Bearer <access_token>` on everything except `/auth/login`,
  `/auth/refresh`, `/auth/accept-invite`, `/auth/invite/{token}`, `/health`, and the OW
  webhook.
- Org-scoped routes live under `/orgs/{org_id}/...`. Being a member of the org is
  required; further checks per route are listed as **Access**.
- Lists: `?limit=` (default 50, max 500) and `?offset=`; response
  `Page<T> = { items: T[], total: number }`.
- A `POST` that creates a resource answers 201; other successes are 200, or 204 without a body.
- Errors: FastAPI shape `{ "detail": string }` with 400/401/403/404/409. Request-body
  validation errors are 422 with FastAPI's default list. **Submission validation**
  failures are 422 with
  `{ "detail": { "message": "invalid submission", "field_errors": { [field_key]: code } } }`,
  codes per [FORMS.md](FORMS.md).
- 401 means the access token is missing/expired (client refreshes once, then logs out);
  403 means authenticated but not allowed.

## Types

```ts
type UUID = string; type ISODate = string; type ISODateTime = string;
type Page<T> = { items: T[]; total: number };

type OrgRole = "owner" | "admin" | "staff" | "athlete";
type AccessRole = "viewer" | "coach" | "practitioner" | "medical" | "researcher";
type GroupKind = "team" | "squad" | "unit" | "section" | "study" | "cohort" | "other";
type Sensitivity = "general" | "medical" | "research";
type FormKind = "questionnaire" | "session" | "test" | "medical" | "profile" | "import";
type SubmissionSource = "mobile" | "web" | "import" | "api";
type Flag = "green" | "amber" | "red" | null;

type User = { id: UUID; email: string; full_name: string; is_active: boolean; created_at: ISODateTime };

type Terminology = { athlete: string; athletes: string; group: string; groups: string };
// defaults: { athlete: "Athlete", athletes: "Athletes", group: "Group", groups: "Groups" }

type Organization = {
  id: UUID; name: string; slug: string; timezone: string;           // IANA, e.g. "America/New_York"
  settings: {
    terminology: Terminology;
    readiness_metrics: string[];                                     // metric slugs shown on the readiness board, in order
  };
  created_at: ISODateTime;
};

type Membership = { org: Organization; role: OrgRole; athlete_id: UUID | null };   // athlete_id set when this user is an athlete in the org

type Me = { user: User; memberships: Membership[] };

type TokenPair = { access_token: string; refresh_token: string; token_type: "bearer"; expires_in: number };   // seconds
type LoginResponse = TokenPair & { user: User };

type Group = {
  id: UUID; org_id: UUID; parent_id: UUID | null; name: string; kind: GroupKind;
  description: string | null; archived: boolean; athlete_count: number; created_at: ISODateTime;
};

type AthleteStatus = "active" | "inactive" | "archived";
type Sex = "female" | "male" | "other" | "undisclosed";

type Athlete = {
  id: UUID; org_id: UUID; code: string;
  // PII: null when the caller may not view identifiable data for this athlete (see masked)
  first_name: string | null; last_name: string | null; preferred_name: string | null;
  email: string | null; date_of_birth: ISODate | null;
  display_name: string;            // "Preferred Last" / "First Last", or the code when masked
  masked: boolean;
  sex: Sex | null; position: string | null; timezone: string | null;  // null → org timezone
  status: AthleteStatus;
  attributes: Record<string, unknown>;
  group_ids: UUID[];               // current memberships
  user_id: UUID | null;            // has a login
  ow_user_id: UUID | null;         // linked to Open Wearables
  created_at: ISODateTime;
};

type AthleteCreate = {
  code?: string;                   // generated "A-0001"-style when omitted
  first_name: string; last_name: string; preferred_name?: string | null;
  email?: string | null; date_of_birth?: ISODate | null; sex?: Sex | null;
  position?: string | null; timezone?: string | null;
  attributes?: Record<string, unknown>; group_ids?: UUID[];
};
type AthleteUpdate = Partial<AthleteCreate> & { status?: AthleteStatus };

type Member = { user: User; role: OrgRole; athlete_id: UUID | null; assignments: StaffAssignment[] };
type StaffAssignment = { id: UUID; user_id: UUID; group_id: UUID; access_role: AccessRole; can_view_identifiable: boolean };

type Invitation = {
  id: UUID; email: string; role: OrgRole; athlete_id: UUID | null;
  expires_at: ISODateTime; accepted_at: ISODateTime | null;
  invite_url: string;              // web URL with token; mobile deep link is ams://accept-invite?token=...
};

// ---- Forms (schema types are defined in FORMS.md / @ams/shared FormSchema)
type Form = {
  id: UUID; org_id: UUID; slug: string; name: string; description: string | null;
  kind: FormKind; sensitivity: Sensitivity;
  athlete_can_submit: boolean; athlete_can_view: boolean;
  allow_multiple_per_day: boolean;
  draft_schema: FormSchema;
  current_version: FormVersion | null;     // null until first publish
  archived: boolean; created_at: ISODateTime; updated_at: ISODateTime;
};
type FormVersion = { id: UUID; form_id: UUID; version: number; schema: FormSchema; published_at: ISODateTime };
type FormCreate = {
  name: string; slug?: string; description?: string | null; kind: FormKind; sensitivity?: Sensitivity;
  athlete_can_submit?: boolean; athlete_can_view?: boolean; allow_multiple_per_day?: boolean;
  draft_schema?: FormSchema;
};
type FormUpdate = Partial<FormCreate> & { archived?: boolean };
type SchemaError = { path: string; message: string };

type FormTemplate = { key: string; name: string; description: string; kind: FormKind; sensitivity: Sensitivity; schema: FormSchema; references: string[] };

type Recurrence = "daily" | "weekly" | "once";
type FormSchedule = {
  id: UUID; form_id: UUID; group_id: UUID;
  recurrence: Recurrence; days_of_week: number[];   // ISO weekday 1=Mon..7=Sun; used when recurrence = "weekly"
  due_time: string;                                  // "HH:MM" athlete-local
  start_date: ISODate; end_date: ISODate | null;     // "once": start_date is the day
  remind: boolean; active: boolean;
};

// ---- Submissions
type Submission = {
  id: UUID; org_id: UUID; form_id: UUID; form_version_id: UUID; form_version: number;
  athlete_id: UUID; athlete_display_name: string;
  submitted_by: UUID | null;                          // user id
  observed_at: ISODateTime; local_date: ISODate;
  values: Record<string, unknown>; computed: Record<string, unknown>;
  source: SubmissionSource; import_batch_id: UUID | null;
  created_at: ISODateTime; updated_at: ISODateTime;
};
type SubmissionCreate = {
  form_id: UUID; athlete_id: UUID;
  values: Record<string, unknown>;
  observed_at?: ISODateTime;          // default now
  local_date?: ISODate;               // default: observed_at in the athlete's timezone
};
type BulkSubmissionCreate = {
  form_id: UUID; local_date: ISODate; observed_at?: ISODateTime;
  entries: { athlete_id: UUID; values: Record<string, unknown> }[];
};
type BulkSubmissionResult = {
  created: Submission[];
  errors: { athlete_id: UUID; field_errors: Record<string, string> }[];   // entries that failed; the rest are saved
};   // besides FORMS.md codes: { athlete_id: "not_found" | "forbidden" } and { local_date: "duplicate" }

// ---- Imports
type ImportPreview = {
  upload_id: UUID;                    // server keeps the file 24 h for the commit call
  columns: string[]; row_count: number; sample_rows: Record<string, string>[];   // first 10
  suggested_mapping: Record<string, string>;     // csv column → field key
  suggested_athlete_column: string | null;
  suggested_date_column: string | null;
};
type ImportCommit = {
  upload_id: UUID;
  mapping: Record<string, string>;               // csv column → field key
  athlete_column: string; athlete_match: "code" | "email" | "name" | "external_id";
  date_column: string | null;                    // null → every row uses `default_date`
  date_format?: string | null;                   // strptime format; null → ISO 8601 / auto
  default_date?: ISODate | null;
  timezone?: string | null;                      // for date-times without offset; default org timezone
  dry_run?: boolean;
};
type ImportBatch = {
  id: UUID; form_id: UUID; filename: string; created_by: UUID; created_at: ISODateTime;
  row_count: number; created_count: number; skipped_count: number;
  errors: { row: number; message: string }[];    // 1-based data row numbers
  dry_run: boolean;
};

// ---- Wearables (proxied from Open Wearables)
type WearableProvider = { provider: string; name: string; enabled: boolean; kind: "cloud" | "sdk"; icon_url: string | null };
type WearableConnection = {
  connection_id: UUID; provider: string; status: string;   // OW status string, e.g. "active", "revoked"
  account_type: string | null; account_label: string | null;
  last_synced_at: ISODateTime | null; created_at: ISODateTime | null;
  devices: string[];                                         // humanized observed devices, most recent first
};
type WearableStatus = { linked: boolean; ow_user_id: UUID | null; connections: WearableConnection[] };
type ConnectRequest = { provider: string; account_type?: string | null; account_label?: string | null; redirect_uri?: string | null;
                        new_account?: boolean | null };   // true: add another account with this provider (OW new_account)
type ConnectResponse = { authorization_url: string };
type SdkTokenResponse = { access_token: string; refresh_token: string; expires_in: number; ow_base_url: string; ow_user_id: UUID };

type WearableMetric =
  | "sleep_duration_min" | "sleep_efficiency_pct" | "sleep_deep_min" | "sleep_rem_min" | "sleep_light_min" | "sleep_awake_min"
  | "time_in_bed_min" | "sleep_hrv_rmssd_ms" | "sleep_resting_hr_bpm" | "respiratory_rate"
  | "hrv_rmssd_ms" | "resting_hr_bpm" | "recovery_score"
  | "steps" | "active_energy_kcal" | "distance_m" | "active_min" | "moderate_min" | "vigorous_min"
  | "weight_kg" | "body_fat_pct";
type WearableDailyPoint = { local_date: ISODate; metric: WearableMetric; value: number; unit: string; provider: string; device: string | null };

// ---- Metrics
type SeriesRef = string;   // "form:<form_slug>.<field_key>" | "wearable:<metric>" | "metric:<metric_slug>"
type DailyAgg = "sum" | "mean" | "last" | "max" | "min";
type Transform = "none" | "rolling_mean" | "rolling_sum" | "ewma" | "acwr" | "zscore" | "pct_change" | "monotony" | "strain";
type Thresholds = { direction: "high_bad" | "low_bad" | "both_bad"; amber: number | null; red: number | null } | null;
type MetricDefinition = {
  id: UUID; org_id: UUID; slug: string; name: string; description: string | null; unit: string | null;
  source: SeriesRef; daily_agg: DailyAgg; fill_zero: boolean;   // fill_zero: days without data between the athlete's first and last observation count as 0 (loads); otherwise missing
  transform: Transform; params: Record<string, number | string | boolean>;
  thresholds: Thresholds; decimals: number; athlete_visible: boolean; builtin: boolean;
};
type MetricCreate = Omit<MetricDefinition, "id" | "org_id" | "builtin">;
type SeriesSource = { ref: SeriesRef; label: string; unit: string | null; kind: "form" | "wearable" | "metric" };
type MetricPoint = { date: ISODate; value: number | null; flag: Flag; source: string | null };   // source: provider/device for wearable-based points
type MetricSeries = { metric: MetricDefinition; athlete_id: UUID; points: MetricPoint[] };

type ReadinessCell = { value: number | null; flag: Flag; date: ISODate | null; missing: ReadinessMissing | null };   // latest value on or before the board date within 3 days; missing set exactly when value is null
type ReadinessMissing = {
  reason:
    | "restricted"   // the caller cannot read the metric's source form for this athlete (nothing else is revealed)
    | "no_source"    // the source at the end of the metric chain does not exist (e.g. the form was never created)
    | "not_linked"   // wearable source, no data, and the athlete has no Open Wearables link
    | "no_data"      // nothing recorded for this athlete on or before the board date
    | "stale"        // the last data (last_date) is older than the 3-day window
    | "building"     // data in the window, but fewer observed days than the transform needs (have < need)
    | "no_value";    // requirements met but the value is undefined (e.g. a zero baseline SD)
  source: SeriesRef | null;   // the form or wearable source at the end of the metric chain (null when restricted)
  last_date: ISODate | null;  // stale / building / no_value: last day with source data on or before the board date
  have: number | null;        // building: observed days so far
  need: number | null;        // building: observed days required
  window: number | null;      // building: days counted over, ending on last_date (null = all history)
  same_source: boolean;       // building: only days from that day's provider/device count (baselines)
};
type ReadinessRow = {
  athlete: { id: UUID; display_name: string; code: string; position: string | null };
  cells: Record<string, ReadinessCell>;         // keyed by metric slug
  due_forms: number;                            // forms due today not yet submitted
  scheduled_forms: number;                      // published forms with a schedule in force for the athlete's groups (0: nothing is ever due)
};
type ReadinessBoard = { date: ISODate; group_id: UUID | null; columns: MetricDefinition[]; rows: ReadinessRow[] };

type DueForm = { form: Form; version: FormVersion; due_time: string | null; completed: boolean; last_submitted_at: ISODateTime | null };

type AuditEntry = { id: UUID; user_id: UUID | null; action: string; entity_type: string; entity_id: UUID | null; at: ISODateTime; details: Record<string, unknown> };
```

## Endpoints

### Auth and identity

| Method | Path | Body → Response | Notes |
|---|---|---|---|
| POST | `/auth/login` | `{email, password}` → `LoginResponse` | 401 on bad credentials |
| POST | `/auth/refresh` | `{refresh_token}` → `TokenPair` | Rotates: the old refresh token is revoked |
| POST | `/auth/logout` | `{refresh_token}` → 204 | |
| GET | `/auth/invite/{token}` | → `{email, org_name, role, expires_at}` | Public, to render the accept page |
| POST | `/auth/accept-invite` | `{token, password, full_name}` → `LoginResponse` | Creates the user if needed and the membership; links `athlete.user_id` for athlete invites |
| GET | `/me` | → `Me` | |
| PATCH | `/me` | `{full_name?, password?, current_password?}` → `User` | `current_password` required to change password |
| POST | `/me/push-tokens` | `{token, platform: "ios"\|"android"}` → 204 | Expo push token; upsert |
| DELETE | `/me/push-tokens/{token}` | → 204 | |

### Organization, members, invitations

| Method | Path | Body → Response | Access |
|---|---|---|---|
| GET | `/orgs/{org_id}` | → `Organization` | member |
| PATCH | `/orgs/{org_id}` | `{name?, timezone?, settings?}` → `Organization` | admin |
| GET | `/orgs/{org_id}/members` | → `Member[]` | admin: everyone; other staff: staff members only (an athlete's membership would unmask them; athletes are listed via `/athletes`) |
| PATCH | `/orgs/{org_id}/members/{user_id}` | `{role}` → `Member` | admin; cannot demote the last owner (409); only an owner grants or revokes `owner` |
| DELETE | `/orgs/{org_id}/members/{user_id}` | → 204 | admin |
| GET | `/orgs/{org_id}/invitations` | → `Invitation[]` (pending) | admin |
| POST | `/orgs/{org_id}/invitations` | `{email, role, athlete_id?}` → `Invitation` | admin. `role: "athlete"` requires `athlete_id` |
| DELETE | `/orgs/{org_id}/invitations/{id}` | → 204 | admin |
| POST | `/orgs/{org_id}/athletes/{athlete_id}/invite` | `{email?}` → `Invitation` | admin or staff with write on the athlete. Uses athlete email when omitted |

### Groups and staff assignments

| Method | Path | Body → Response | Access |
|---|---|---|---|
| GET | `/orgs/{org_id}/groups` | `?include_archived=false` → `Group[]` | staff: groups they are assigned to, their descendants and ancestors (ancestors for tree context only) |
| POST | `/orgs/{org_id}/groups` | `{name, kind, parent_id?, description?}` → `Group` | admin |
| GET/PATCH/DELETE | `/orgs/{org_id}/groups/{group_id}` | `{name?, kind?, parent_id?, description?, archived?}` → `Group` | admin for writes; DELETE archives |
| POST | `/orgs/{org_id}/groups/{group_id}/athletes` | `{athlete_ids, joined_on?}` → `Group` | admin or staff with write on the group |
| DELETE | `/orgs/{org_id}/groups/{group_id}/athletes/{athlete_id}` | `?left_on=` → 204 | same; sets `left_on`, keeps history |
| GET | `/orgs/{org_id}/groups/{group_id}/staff` | → `StaffAssignment[]` | admin |
| POST | `/orgs/{org_id}/groups/{group_id}/staff` | `{user_id, access_role, can_view_identifiable?}` → `StaffAssignment` | admin. `can_view_identifiable` default true |
| DELETE | `/orgs/{org_id}/staff-assignments/{id}` | → 204 | admin |

### Athletes

| Method | Path | Body → Response | Access |
|---|---|---|---|
| GET | `/orgs/{org_id}/athletes` | `?group_id&q&status&limit&offset` → `Page<Athlete>` | visible athletes only. `q` matches code, names, email (names/email only where identifiable). Without `status`, archived athletes are left out; `group_id` includes descendant groups |
| POST | `/orgs/{org_id}/athletes` | `AthleteCreate` → `Athlete` | admin, or staff with write on every listed group |
| GET | `/orgs/{org_id}/athletes/{athlete_id}` | → `Athlete` | visible |
| PATCH | `/orgs/{org_id}/athletes/{athlete_id}` | `AthleteUpdate` → `Athlete` | write on athlete |
| DELETE | `/orgs/{org_id}/athletes/{athlete_id}` | → 204 | admin; sets `status = archived` |

### Forms, versions, templates, schedules

| Method | Path | Body → Response | Access |
|---|---|---|---|
| GET | `/orgs/{org_id}/forms` | `?kind&include_archived` → `Form[]` | forms whose sensitivity the caller can read |
| POST | `/orgs/{org_id}/forms` | `FormCreate` → `Form` | admin |
| GET | `/orgs/{org_id}/forms/{form_id}` | → `Form` | readable |
| PATCH | `/orgs/{org_id}/forms/{form_id}` | `FormUpdate` → `Form` | admin. Saving `draft_schema` does not validate |
| POST | `/orgs/{org_id}/forms/{form_id}/publish` | → `FormVersion` | admin. 422 `{detail: {message, schema_errors: SchemaError[]}}` when the draft is invalid. No-op (returns current) when the draft equals the current version |
| GET | `/orgs/{org_id}/forms/{form_id}/versions` | → `FormVersion[]` (newest first) | readable |
| POST | `/orgs/{org_id}/forms/validate-schema` | `{schema}` → `{valid: boolean, errors: SchemaError[]}` | admin |
| GET | `/orgs/{org_id}/form-templates` | → `FormTemplate[]` | admin |
| POST | `/orgs/{org_id}/form-templates/{key}/install` | `{name?, slug?}` → `Form` (published v1) | admin |
| GET | `/orgs/{org_id}/forms/{form_id}/schedules` | → `FormSchedule[]` | readable |
| POST | `/orgs/{org_id}/forms/{form_id}/schedules` | `Omit<FormSchedule, "id"\|"form_id">` → `FormSchedule` | admin |
| PATCH/DELETE | `/orgs/{org_id}/form-schedules/{schedule_id}` | partial → `FormSchedule` / 204 | admin |

Built-in templates (`key`): `wellness_hooper` (Hooper & Mackinnon 1995, 1–7 scales),
`session_rpe` (CR-10 × duration, Foster et al. 2001), `injury_report` (medical),
`cmj_test` (force plate CMJ: jump height, RSI-modified, peak power, body mass),
`gps_session` (total distance, high-speed running, sprint distance, accelerations,
decelerations, player load, duration), `body_mass` (morning body mass, urine specific
gravity).

### Submissions

| Method | Path | Body → Response | Access |
|---|---|---|---|
| GET | `/orgs/{org_id}/submissions` | `?form_id&athlete_id&group_id&start&end&source&limit&offset` → `Page<Submission>` | read on form sensitivity + athlete visible. `start`/`end` filter `local_date`, inclusive. Newest first. Reads of medical/research forms are audited |
| POST | `/orgs/{org_id}/submissions` | `SubmissionCreate` → `Submission` (201) | write on athlete + form sensitivity. 422 field errors. 409 when the form disallows multiple per day and one exists for that `local_date` |
| POST | `/orgs/{org_id}/submissions/bulk` | `BulkSubmissionCreate` → `BulkSubmissionResult` | same, per entry |
| GET | `/orgs/{org_id}/submissions/{id}` | → `Submission` | as list |
| PATCH | `/orgs/{org_id}/submissions/{id}` | `{values?, observed_at?, local_date?}` → `Submission` | write. `values` replaces the stored values. Validated against the submission's own form version. Audited with before/after |
| DELETE | `/orgs/{org_id}/submissions/{id}` | → 204 | write. Soft delete, audited |
| GET | `/orgs/{org_id}/submissions/export` | `?form_id` (req) `&group_id&start&end&deidentified=false` → `text/csv` | read. One row per submission: `submission_id, athlete_code, [athlete_name], local_date, observed_at, source, form_version, <fields...>, <calculated...>`. Name column omitted when `deidentified=true` or masked |

### Imports

| Method | Path | Body → Response | Access |
|---|---|---|---|
| POST | `/orgs/{org_id}/forms/{form_id}/imports/preview` | multipart `file` (.csv, .xlsx) → `ImportPreview` | write on form |
| POST | `/orgs/{org_id}/forms/{form_id}/imports` | `ImportCommit` → `ImportBatch` | write on form. Rows whose athlete can't be matched or that fail validation are skipped and reported |
| GET | `/orgs/{org_id}/imports` | `?form_id` → `ImportBatch[]` | read |
| DELETE | `/orgs/{org_id}/imports/{batch_id}` | → 204 | admin. Soft-deletes every submission from the batch |

### Athlete self-service (mobile)

All require the caller to be an athlete in the org (`membership.athlete_id`).

| Method | Path | Body → Response |
|---|---|---|
| GET | `/orgs/{org_id}/me/athlete` | → `Athlete` |
| GET | `/orgs/{org_id}/me/forms` | `?date` (athlete-local, default today) → `DueForm[]`: every form with `athlete_can_submit`, scheduled ones first |
| GET | `/orgs/{org_id}/me/submissions` | `?form_id&start&end&limit&offset` → `Page<Submission>` (forms with `athlete_can_view` only) |
| POST | `/orgs/{org_id}/me/submissions` | `Omit<SubmissionCreate, "athlete_id">` → `Submission` |
| GET | `/orgs/{org_id}/me/metrics` | `?start&end` → `MetricSeries[]` for `athlete_visible` metrics |
| GET | `/orgs/{org_id}/me/wearables` | → `WearableStatus` (links to OW on first call) |
| GET | `/orgs/{org_id}/me/wearables/providers` | → `WearableProvider[]` |
| POST | `/orgs/{org_id}/me/wearables/connect` | `ConnectRequest` → `ConnectResponse` |
| POST | `/orgs/{org_id}/me/wearables/sdk-token` | → `SdkTokenResponse` (503 when OW app credentials are not configured) |

### Wearables (staff)

| Method | Path | Body → Response | Access |
|---|---|---|---|
| GET | `/orgs/{org_id}/wearables/providers` | → `WearableProvider[]` | staff |
| GET | `/orgs/{org_id}/athletes/{athlete_id}/wearables` | → `WearableStatus` | visible |
| POST | `/orgs/{org_id}/athletes/{athlete_id}/wearables/link` | → `WearableStatus` | write. Idempotent; creates the OW user |
| POST | `/orgs/{org_id}/athletes/{athlete_id}/wearables/connect` | `ConnectRequest` → `ConnectResponse` | write. Links first if needed |
| POST | `/orgs/{org_id}/athletes/{athlete_id}/wearables/refresh` | `?days=7` → `{updated: number}` | write. Pulls OW daily summaries into `wearable_daily` now (409 when not linked) |
| GET | `/orgs/{org_id}/athletes/{athlete_id}/wearables/daily` | `?start&end&metrics=a,b` → `WearableDailyPoint[]` | visible |
| POST | `/integrations/open-wearables/webhook` | svix-signed OW event → 204 | Public; verified with `OW_WEBHOOK_SECRET` (401 bad or stale signature, 503 when unset). Unknown OW users are a no-op |

### Metrics and dashboards

| Method | Path | Body → Response | Access |
|---|---|---|---|
| GET | `/orgs/{org_id}/metrics` | → `MetricDefinition[]` | staff |
| POST | `/orgs/{org_id}/metrics` | `MetricCreate` → `MetricDefinition` | admin. 422 on unknown source or circular `metric:` references |
| PATCH/DELETE | `/orgs/{org_id}/metrics/{metric_id}` | partial → `MetricDefinition` / 204 | admin. Built-ins can be edited, not deleted |
| GET | `/orgs/{org_id}/series-sources` | → `SeriesSource[]` | staff. Numeric/boolean form fields (incl. calculated), wearable metrics, metrics |
| GET | `/orgs/{org_id}/metrics/{slug}/series` | `?athlete_id&start&end` → `MetricSeries` | athlete visible; source form sensitivity readable. The engine loads enough history before `start` to fill windows |
| GET | `/orgs/{org_id}/dashboards/readiness` | `?group_id&date` → `ReadinessBoard` | staff; rows are visible athletes in the group (or all visible) |
| GET | `/orgs/{org_id}/audit` | `?entity_type&entity_id&limit&offset` → `Page<AuditEntry>` | admin |

### Metric transforms

All operate on the daily series produced by `daily_agg` over `source`, over the
athlete's calendar days. Unless `fill_zero`, days without data are missing (NaN), and a
window yields null when it has fewer than `min_periods` observations.

| `transform` | `params` (defaults) | Value |
|---|---|---|
| `none` | – | the daily value |
| `rolling_mean` | `window` (7), `min_periods` (ceil(window × 0.7)), `ln` (false) | mean over the trailing window incl. today (`ln`: of ln(x)) |
| `rolling_sum` | `window` (7), `min_periods` (window) | sum over the trailing window |
| `ewma` | `span` (7) | exponentially weighted mean, λ = 2/(span+1) (Williams et al. 2017) |
| `acwr` | `acute` (7), `chronic` (28), `method` ("rolling" \| "ewma", "ewma"), `coupled` (false) | acute / chronic. `coupled=false`: the chronic window excludes the acute window (Lolli et al. 2019) |
| `zscore` | `baseline` (28), `min_periods` (14), `smooth` (1), `ln` (false) | (x̄_smooth − mean_baseline) / sd_baseline, baseline = the `baseline` days before today (excluding today), same-source days only |
| `pct_change` | `baseline` (28), `min_periods` (14) | 100 × (x − mean_baseline) / mean_baseline |
| `monotony` | `window` (7) | mean / sd of daily load over the window (Foster 1998); null when sd = 0 |
| `strain` | `window` (7) | weekly load sum × monotony |

`thresholds.direction`: `high_bad` → `value ≥ red` red, `≥ amber` amber, else green;
`low_bad` → `value ≤ red` red, `≤ amber` amber; `both_bad` compares `|value|`. A null
value or null thresholds give flag `null`.

## Open Wearables calls made by the API

All with header `X-Open-Wearables-API-Key: $OW_API_KEY` unless noted.

| Purpose | OW call |
|---|---|
| Link athlete | `POST /api/v1/users` `{first_name, last_name, email, external_user_id: <athlete uuid>}` (on 409/duplicate, look up by external id) |
| Providers | `GET /api/v1/oauth/providers` |
| Connect URL | `GET /api/v1/oauth/{provider}/authorize?user_id&redirect_uri&new_account&account_type&account_label` |
| Connections | `GET /api/v1/users/{user_id}/connections` |
| SDK token | `POST /api/v1/users/{user_id}/token` body `{app_id: $OW_APP_ID, app_secret: $OW_APP_SECRET}` (no API key) |
| Daily data | `GET /api/v1/users/{user_id}/summaries/{sleep,recovery,activity}?start_date&end_date` (OW's default `filter_by_priority=true` on summaries) |
| Weight / body fat | `GET /api/v1/users/{user_id}/timeseries?types=weight,body_fat_percentage&start_time&end_time&resolution=raw` (`/summaries/body` carries no measurement dates) |
