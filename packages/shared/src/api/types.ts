/**
 * Types of the AMS API contract (docs/API.md). Field names are the wire names
 * (snake_case). Keep this file in sync with docs/API.md.
 */
import type { FormSchema, SchemaError } from "../forms/types";

export type { FormSchema, SchemaError };

export type UUID = string;
/** `YYYY-MM-DD` */
export type ISODate = string;
/** ISO 8601 with offset, e.g. `2026-10-12T06:31:00Z` */
export type ISODateTime = string;

export type Page<T> = { items: T[]; total: number };

export type OrgRole = "owner" | "admin" | "staff" | "athlete";
export type AccessRole = "viewer" | "coach" | "practitioner" | "medical" | "researcher";
export type GroupKind = "team" | "squad" | "unit" | "section" | "study" | "cohort" | "other";
export type Sensitivity = "general" | "medical" | "research";
export type FormKind = "questionnaire" | "session" | "test" | "medical" | "profile" | "import";
export type SubmissionSource = "mobile" | "web" | "import" | "api";
export type Flag = "green" | "amber" | "red" | null;

export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "staff", "athlete"];
export const ACCESS_ROLES: readonly AccessRole[] = ["viewer", "coach", "practitioner", "medical", "researcher"];
export const GROUP_KINDS: readonly GroupKind[] = ["team", "squad", "unit", "section", "study", "cohort", "other"];
export const SENSITIVITIES: readonly Sensitivity[] = ["general", "medical", "research"];
export const FORM_KINDS: readonly FormKind[] = ["questionnaire", "session", "test", "medical", "profile", "import"];
export const SUBMISSION_SOURCES: readonly SubmissionSource[] = ["mobile", "web", "import", "api"];

export type User = { id: UUID; email: string; full_name: string; is_active: boolean; created_at: ISODateTime };

export type Terminology = { athlete: string; athletes: string; group: string; groups: string };

export type OrganizationSettings = {
  terminology: Terminology;
  /** Metric slugs shown on the readiness board, in order. */
  readiness_metrics: string[];
};

export type Organization = {
  id: UUID;
  name: string;
  slug: string;
  /** IANA, e.g. "America/New_York" */
  timezone: string;
  settings: OrganizationSettings;
  created_at: ISODateTime;
};

/** `athlete_id` is set when this user is an athlete in the org. */
export type Membership = { org: Organization; role: OrgRole; athlete_id: UUID | null };

export type Me = { user: User; memberships: Membership[] };

export type TokenPair = { access_token: string; refresh_token: string; token_type: "bearer"; expires_in: number };
export type LoginResponse = TokenPair & { user: User };

export type Group = {
  id: UUID;
  org_id: UUID;
  parent_id: UUID | null;
  name: string;
  kind: GroupKind;
  description: string | null;
  archived: boolean;
  athlete_count: number;
  created_at: ISODateTime;
};

export type AthleteStatus = "active" | "inactive" | "archived";
export type Sex = "female" | "male" | "other" | "undisclosed";

export type Athlete = {
  id: UUID;
  org_id: UUID;
  code: string;
  /** PII: null when the caller may not view identifiable data for this athlete (see `masked`). */
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  date_of_birth: ISODate | null;
  /** "Preferred Last" / "First Last", or the code when masked. */
  display_name: string;
  masked: boolean;
  sex: Sex | null;
  position: string | null;
  /** null -> org timezone */
  timezone: string | null;
  status: AthleteStatus;
  attributes: Record<string, unknown>;
  /** Current memberships. */
  group_ids: UUID[];
  /** Has a login. */
  user_id: UUID | null;
  /** Linked to Open Wearables. */
  ow_user_id: UUID | null;
  created_at: ISODateTime;
};

export type AthleteCreate = {
  /** Generated "A-0001"-style when omitted. */
  code?: string;
  first_name: string;
  last_name: string;
  preferred_name?: string | null;
  email?: string | null;
  date_of_birth?: ISODate | null;
  sex?: Sex | null;
  position?: string | null;
  timezone?: string | null;
  attributes?: Record<string, unknown>;
  group_ids?: UUID[];
};
export type AthleteUpdate = Partial<AthleteCreate> & { status?: AthleteStatus };

export type StaffAssignment = {
  id: UUID;
  user_id: UUID;
  group_id: UUID;
  access_role: AccessRole;
  can_view_identifiable: boolean;
};
export type Member = { user: User; role: OrgRole; athlete_id: UUID | null; assignments: StaffAssignment[] };

export type Invitation = {
  id: UUID;
  email: string;
  role: OrgRole;
  athlete_id: UUID | null;
  expires_at: ISODateTime;
  accepted_at: ISODateTime | null;
  /** Web URL with token; the mobile deep link is ams://accept-invite?token=... */
  invite_url: string;
};

// ---- Forms (schema types: FormSchema from forms/)

export type FormVersion = { id: UUID; form_id: UUID; version: number; schema: FormSchema; published_at: ISODateTime };

export type Form = {
  id: UUID;
  org_id: UUID;
  slug: string;
  name: string;
  description: string | null;
  kind: FormKind;
  sensitivity: Sensitivity;
  athlete_can_submit: boolean;
  athlete_can_view: boolean;
  allow_multiple_per_day: boolean;
  draft_schema: FormSchema;
  /** null until first publish */
  current_version: FormVersion | null;
  archived: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
};

export type FormCreate = {
  name: string;
  slug?: string;
  description?: string | null;
  kind: FormKind;
  sensitivity?: Sensitivity;
  athlete_can_submit?: boolean;
  athlete_can_view?: boolean;
  allow_multiple_per_day?: boolean;
  draft_schema?: FormSchema;
};
export type FormUpdate = Partial<FormCreate> & { archived?: boolean };

export type FormTemplate = {
  key: string;
  name: string;
  description: string;
  kind: FormKind;
  sensitivity: Sensitivity;
  schema: FormSchema;
  references: string[];
};

export type Recurrence = "daily" | "weekly" | "once";
export type FormSchedule = {
  id: UUID;
  form_id: UUID;
  group_id: UUID;
  recurrence: Recurrence;
  /** ISO weekday 1=Mon..7=Sun; used when recurrence = "weekly". */
  days_of_week: number[];
  /** "HH:MM" athlete-local */
  due_time: string;
  /** "once": start_date is the day. */
  start_date: ISODate;
  end_date: ISODate | null;
  remind: boolean;
  active: boolean;
};

// ---- Submissions

export type Submission = {
  id: UUID;
  org_id: UUID;
  form_id: UUID;
  form_version_id: UUID;
  form_version: number;
  athlete_id: UUID;
  athlete_display_name: string;
  /** User id. */
  submitted_by: UUID | null;
  observed_at: ISODateTime;
  local_date: ISODate;
  values: Record<string, unknown>;
  computed: Record<string, unknown>;
  source: SubmissionSource;
  import_batch_id: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
};

export type SubmissionCreate = {
  form_id: UUID;
  athlete_id: UUID;
  values: Record<string, unknown>;
  /** Default now. */
  observed_at?: ISODateTime;
  /** Default: observed_at in the athlete's timezone. */
  local_date?: ISODate;
};

export type BulkSubmissionCreate = {
  form_id: UUID;
  local_date: ISODate;
  observed_at?: ISODateTime;
  entries: { athlete_id: UUID; values: Record<string, unknown> }[];
};

export type BulkSubmissionResult = {
  created: Submission[];
  /** Entries that failed; the rest are saved. */
  errors: { athlete_id: UUID; field_errors: Record<string, string> }[];
};

// ---- Imports

export type ImportPreview = {
  /** The server keeps the file 24 h for the commit call. */
  upload_id: UUID;
  columns: string[];
  row_count: number;
  /** First 10 rows. */
  sample_rows: Record<string, string>[];
  /** csv column -> field key */
  suggested_mapping: Record<string, string>;
  suggested_athlete_column: string | null;
  suggested_date_column: string | null;
};

export type AthleteMatch = "code" | "email" | "name" | "external_id";

export type ImportCommit = {
  upload_id: UUID;
  /** csv column -> field key */
  mapping: Record<string, string>;
  athlete_column: string;
  athlete_match: AthleteMatch;
  /** null -> every row uses `default_date` */
  date_column: string | null;
  /** strptime format; null -> ISO 8601 / auto */
  date_format?: string | null;
  default_date?: ISODate | null;
  /** For date-times without offset; default org timezone. */
  timezone?: string | null;
  dry_run?: boolean;
};

export type ImportBatch = {
  id: UUID;
  form_id: UUID;
  filename: string;
  created_by: UUID;
  created_at: ISODateTime;
  row_count: number;
  created_count: number;
  skipped_count: number;
  /** 1-based data row numbers. */
  errors: { row: number; message: string }[];
  dry_run: boolean;
};

// ---- Wearables (proxied from Open Wearables)

export type WearableProvider = {
  provider: string;
  name: string;
  enabled: boolean;
  kind: "cloud" | "sdk";
  icon_url: string | null;
};

export type WearableConnection = {
  connection_id: UUID;
  provider: string;
  /** OW status string, e.g. "active", "revoked". */
  status: string;
  account_type: string | null;
  account_label: string | null;
  last_synced_at: ISODateTime | null;
  created_at: ISODateTime | null;
  /** Humanized observed devices, most recent first. */
  devices: string[];
};

export type WearableStatus = { linked: boolean; ow_user_id: UUID | null; connections: WearableConnection[] };

export type ConnectRequest = {
  provider: string;
  account_type?: string | null;
  account_label?: string | null;
  redirect_uri?: string | null;
};
export type ConnectResponse = { authorization_url: string };

export type SdkTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  ow_base_url: string;
  ow_user_id: UUID;
};

export type WearableMetric =
  | "sleep_duration_min"
  | "sleep_efficiency_pct"
  | "sleep_deep_min"
  | "sleep_rem_min"
  | "sleep_light_min"
  | "sleep_awake_min"
  | "time_in_bed_min"
  | "sleep_hrv_rmssd_ms"
  | "sleep_resting_hr_bpm"
  | "respiratory_rate"
  | "hrv_rmssd_ms"
  | "resting_hr_bpm"
  | "recovery_score"
  | "steps"
  | "active_energy_kcal"
  | "distance_m"
  | "active_min"
  | "moderate_min"
  | "vigorous_min"
  | "weight_kg"
  | "body_fat_pct";

export const WEARABLE_METRICS: readonly WearableMetric[] = [
  "sleep_duration_min",
  "sleep_efficiency_pct",
  "sleep_deep_min",
  "sleep_rem_min",
  "sleep_light_min",
  "sleep_awake_min",
  "time_in_bed_min",
  "sleep_hrv_rmssd_ms",
  "sleep_resting_hr_bpm",
  "respiratory_rate",
  "hrv_rmssd_ms",
  "resting_hr_bpm",
  "recovery_score",
  "steps",
  "active_energy_kcal",
  "distance_m",
  "active_min",
  "moderate_min",
  "vigorous_min",
  "weight_kg",
  "body_fat_pct",
];

export type WearableDailyPoint = {
  local_date: ISODate;
  metric: WearableMetric;
  value: number;
  unit: string;
  provider: string;
  device: string | null;
};

// ---- Metrics

/** "form:<form_slug>.<field_key>" | "wearable:<metric>" | "metric:<metric_slug>" */
export type SeriesRef = string;
export type DailyAgg = "sum" | "mean" | "last" | "max" | "min";
export type Transform =
  | "none"
  | "rolling_mean"
  | "rolling_sum"
  | "ewma"
  | "acwr"
  | "zscore"
  | "pct_change"
  | "monotony"
  | "strain";
export type ThresholdDirection = "high_bad" | "low_bad" | "both_bad";
export type Thresholds = { direction: ThresholdDirection; amber: number | null; red: number | null } | null;

export type MetricDefinition = {
  id: UUID;
  org_id: UUID;
  slug: string;
  name: string;
  description: string | null;
  unit: string | null;
  source: SeriesRef;
  daily_agg: DailyAgg;
  /** Days without data count as 0 (loads); otherwise missing. */
  fill_zero: boolean;
  transform: Transform;
  params: Record<string, number | string | boolean>;
  thresholds: Thresholds;
  decimals: number;
  athlete_visible: boolean;
  builtin: boolean;
};
export type MetricCreate = Omit<MetricDefinition, "id" | "org_id" | "builtin">;
export type MetricUpdate = Partial<MetricCreate>;

export type SeriesSource = { ref: SeriesRef; label: string; unit: string | null; kind: "form" | "wearable" | "metric" };

/** `source`: provider/device for wearable-based points. */
export type MetricPoint = { date: ISODate; value: number | null; flag: Flag; source: string | null };
export type MetricSeries = { metric: MetricDefinition; athlete_id: UUID; points: MetricPoint[] };

/** Latest value on or before the board date within 3 days. */
export type ReadinessCell = { value: number | null; flag: Flag; date: ISODate | null };
export type ReadinessRow = {
  athlete: { id: UUID; display_name: string; code: string; position: string | null };
  /** Keyed by metric slug. */
  cells: Record<string, ReadinessCell>;
  /** Forms due today not yet submitted. */
  due_forms: number;
};
export type ReadinessBoard = { date: ISODate; group_id: UUID | null; columns: MetricDefinition[]; rows: ReadinessRow[] };

export type DueForm = {
  form: Form;
  version: FormVersion;
  due_time: string | null;
  completed: boolean;
  last_submitted_at: ISODateTime | null;
};

export type AuditEntry = {
  id: UUID;
  user_id: UUID | null;
  action: string;
  entity_type: string;
  entity_id: UUID | null;
  at: ISODateTime;
  details: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Request bodies and responses that API.md writes inline in the endpoint tables.

export type LoginRequest = { email: string; password: string };
export type RefreshRequest = { refresh_token: string };
export type LogoutRequest = { refresh_token: string };
/** `GET /auth/invite/{token}` */
export type InviteDetails = { email: string; org_name: string; role: OrgRole; expires_at: ISODateTime };
export type AcceptInviteRequest = { token: string; password: string; full_name: string };
/** `current_password` is required to change the password. */
export type MeUpdate = { full_name?: string; password?: string; current_password?: string };
export type PushPlatform = "ios" | "android";
export type PushTokenRegister = { token: string; platform: PushPlatform };

export type OrganizationUpdate = {
  name?: string;
  timezone?: string;
  settings?: Partial<OrganizationSettings>;
};
export type MemberUpdate = { role: OrgRole };
/** `role: "athlete"` requires `athlete_id`. */
export type InvitationCreate = { email: string; role: OrgRole; athlete_id?: UUID | null };
/** Uses the athlete's email when omitted. */
export type AthleteInviteRequest = { email?: string | null };

export type GroupCreate = { name: string; kind: GroupKind; parent_id?: UUID | null; description?: string | null };
export type GroupUpdate = {
  name?: string;
  kind?: GroupKind;
  parent_id?: UUID | null;
  description?: string | null;
  archived?: boolean;
};
export type GroupAthletesAdd = { athlete_ids: UUID[]; joined_on?: ISODate | null };
/** `can_view_identifiable` defaults to true. */
export type StaffAssignmentCreate = { user_id: UUID; access_role: AccessRole; can_view_identifiable?: boolean };

export type ValidateSchemaRequest = { schema: FormSchema };
export type ValidateSchemaResponse = { valid: boolean; errors: SchemaError[] };
export type FormTemplateInstall = { name?: string; slug?: string };
export type FormScheduleCreate = Omit<FormSchedule, "id" | "form_id">;
export type FormScheduleUpdate = Partial<FormScheduleCreate>;

export type SubmissionUpdate = { values?: Record<string, unknown>; observed_at?: ISODateTime; local_date?: ISODate };
export type SelfSubmissionCreate = Omit<SubmissionCreate, "athlete_id">;

export type WearableRefreshResponse = { updated: number };

// ---------------------------------------------------------------------------
// Query parameters. `null`/`undefined` values are omitted from the URL.

type Opt<T> = T | null | undefined;

export type PageParams = { limit?: Opt<number>; offset?: Opt<number> };

export type GroupListParams = { include_archived?: Opt<boolean> };
export type GroupRemoveAthleteParams = { left_on?: Opt<ISODate> };
export type AthleteListParams = PageParams & {
  group_id?: Opt<UUID>;
  q?: Opt<string>;
  status?: Opt<AthleteStatus>;
};
export type FormListParams = { kind?: Opt<FormKind>; include_archived?: Opt<boolean> };
export type SubmissionListParams = PageParams & {
  form_id?: Opt<UUID>;
  athlete_id?: Opt<UUID>;
  group_id?: Opt<UUID>;
  /** Inclusive, filters `local_date`. */
  start?: Opt<ISODate>;
  end?: Opt<ISODate>;
  source?: Opt<SubmissionSource>;
};
export type SubmissionExportParams = {
  form_id: UUID;
  group_id?: Opt<UUID>;
  start?: Opt<ISODate>;
  end?: Opt<ISODate>;
  deidentified?: Opt<boolean>;
};
export type ImportListParams = { form_id?: Opt<UUID> };
export type SelfFormsParams = { date?: Opt<ISODate> };
export type SelfSubmissionListParams = PageParams & {
  form_id?: Opt<UUID>;
  start?: Opt<ISODate>;
  end?: Opt<ISODate>;
};
export type DateRangeParams = { start?: Opt<ISODate>; end?: Opt<ISODate> };
export type WearableRefreshParams = { days?: Opt<number> };
export type WearableDailyParams = DateRangeParams & { metrics?: Opt<readonly WearableMetric[]> };
export type MetricSeriesParams = DateRangeParams & { athlete_id: UUID };
export type ReadinessParams = { group_id?: Opt<UUID>; date?: Opt<ISODate> };
export type AuditListParams = PageParams & { entity_type?: Opt<string>; entity_id?: Opt<UUID> };
