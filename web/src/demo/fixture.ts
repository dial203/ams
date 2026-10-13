/**
 * The demo fixtures written by `uv run python -m app.cli export-demo` (api/app/demo_export.py),
 * one file per demo login, served next to the page as `demo/<role>.json`. Every value is a
 * real API response for that login; errors are kept as `{"$error": {status, body}}` so the
 * demo can replay them.
 */
import {
  diffDays,
  isValidTimeZone,
  todayInTimeZone,
  type Athlete,
  type AuditEntry,
  type DueForm,
  type Flag,
  type Form,
  type FormSchedule,
  type FormTemplate,
  type FormVersion,
  type Group,
  type ImportBatch,
  type Invitation,
  type ISODate,
  type Me,
  type Member,
  type MetricDefinition,
  type Organization,
  type Page,
  type ReadinessBoard,
  type SeriesSource,
  type Sensitivity,
  type StaffAssignment,
  type Submission,
  type UUID,
  type WearableDailyPoint,
  type WearableProvider,
  type WearableStatus,
} from "@ams/shared";
import { shiftDates } from "./shift";

export const FIXTURE_FORMAT = 1;

export type DemoRole = "owner" | "coach" | "medic" | "researcher" | "athlete";

export interface FixtureError {
  $error: { status: number; body: unknown };
}
export type Maybe<T> = T | FixtureError;

export function isFixtureError(value: unknown): value is FixtureError {
  return typeof value === "object" && value !== null && "$error" in value;
}

/** Rights of the login over one athlete, as `app.permissions.Principal.rights_for` computed them. */
export interface AthleteAccess {
  identifiable: boolean;
  write: boolean;
  read: Sensitivity[];
  write_forms: Sensitivity[];
}

export interface DemoAccess {
  role: "owner" | "admin" | "staff" | "athlete";
  is_admin: boolean;
  is_owner: boolean;
  athlete_id: UUID | null;
  readable_sensitivities: Sensitivity[];
  writable_sensitivities: Sensitivity[];
  /** null: every group (admin). */
  writable_group_ids: UUID[] | null;
  identifiable_group_ids: UUID[] | null;
  athletes: Record<UUID, AthleteAccess>;
}

/** `[date, value, flag, source]` */
export type CompactPoint = [ISODate, number | null, Flag, string | null];

export interface TemplateSettings {
  athlete_can_submit: boolean;
  athlete_can_view: boolean;
  allow_multiple_per_day: boolean;
}

export interface DemoFixture {
  format: number;
  role: DemoRole;
  email: string;
  /** The seed's "today". */
  generated_on: ISODate;
  data_start: ISODate;
  org_id: UUID;
  audit: Maybe<Page<AuditEntry>>;
  me: Me;
  org: Organization;
  members: Maybe<Member[]>;
  invitations: Maybe<Invitation[]>;
  /** Including archived groups. */
  groups: Maybe<Group[]>;
  staff: Maybe<Record<UUID, Maybe<StaffAssignment[]>>>;
  /** Every visible athlete, archived ones included. */
  athletes: Maybe<Athlete[]>;
  access: DemoAccess;
  /** Including archived forms. */
  forms: Maybe<Form[]>;
  form_versions: Record<UUID, Maybe<FormVersion[]>>;
  schedules: Record<UUID, Maybe<FormSchedule[]>>;
  form_templates: Maybe<FormTemplate[]>;
  template_settings: Record<string, TemplateSettings>;
  submissions: Maybe<Submission[]>;
  imports: Maybe<ImportBatch[]>;
  metrics: Maybe<MetricDefinition[]>;
  series_sources: Maybe<SeriesSource[]>;
  /** Metric series from `data_start` to `generated_on`, per metric slug and athlete id. */
  series: { start: ISODate; end: ISODate; points: Maybe<Record<string, Record<UUID, Maybe<CompactPoint[]>>>> };
  /**
   * All-groups boards of the last 14 days, under "all" and keyed by date. A group's board is
   * the same rows for the group's athletes, so the demo derives it (other keys are used when present).
   */
  readiness: Maybe<Record<string, Record<ISODate, Maybe<ReadinessBoard>>>>;
  wearables: {
    providers: Maybe<WearableProvider[]>;
    status: Record<UUID, Maybe<WearableStatus>>;
    daily: Record<UUID, Maybe<WearableDailyPoint[]>>;
  };
  self?: {
    athlete: Maybe<Athlete>;
    forms: Maybe<DueForm[]>;
    submissions: Maybe<Submission[]>;
    wearables: Maybe<WearableStatus>;
  };
}

/** Days to add so that `generated_on` becomes today in the organization's time zone. */
export function fixtureShift(fixture: Pick<DemoFixture, "generated_on" | "org">, now: Date | number = Date.now()): number {
  const tz = isValidTimeZone(fixture.org.timezone) ? fixture.org.timezone : "UTC";
  return diffDays(fixture.generated_on, todayInTimeZone(tz, now));
}

/** The fixture with every date moved so that it ends today. */
export function prepareFixture(raw: DemoFixture, now: Date | number = Date.now()): DemoFixture {
  if (raw.format !== FIXTURE_FORMAT) {
    throw new Error(`Demo data format ${String(raw.format)} is not supported (expected ${FIXTURE_FORMAT}).`);
  }
  return shiftDates(raw, fixtureShift(raw, now));
}

export type FixtureLoader = (role: DemoRole) => Promise<DemoFixture>;

/** Loads `demo/<role>.json` relative to the page (works at a domain root and under a sub-path). */
export function fetchFixture(fetchImpl: typeof fetch = (...args) => fetch(...args)): FixtureLoader {
  return async (role) => {
    const url = new URL(`demo/${role}.json`, document.baseURI).toString();
    const res = await fetchImpl(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Could not load the demo data (${res.status} for ${url}).`);
    return prepareFixture((await res.json()) as DemoFixture);
  };
}
