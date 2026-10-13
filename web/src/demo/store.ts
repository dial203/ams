/**
 * One demo login's in-memory world: the fixture's API responses, made mutable. Writes from
 * the demo backend land here and live as long as the tab (a reload starts over).
 *
 * Permission decisions come from the fixture (`access`, computed by the API's own permission
 * code at export time); nothing here re-derives who may see what.
 */
import {
  dateInTimeZone,
  isValidTimeZone,
  todayInTimeZone,
  type Athlete,
  type Form,
  type FormSchedule,
  type FormVersion,
  type Group,
  type ImportBatch,
  type Invitation,
  type Member,
  type MetricDefinition,
  type Organization,
  type ReadinessBoard,
  type ReadinessRow,
  type SeriesSource,
  type StaffAssignment,
  type Submission,
  type UUID,
} from "@ams/shared";
import {
  isFixtureError,
  type AthleteAccess,
  type CompactPoint,
  type DemoAccess,
  type DemoFixture,
  type FixtureError,
  type Maybe,
} from "./fixture";
import { fail, orElse } from "./http";

/** An uploaded CSV kept for the import commit call. */
export interface DemoUpload {
  id: UUID;
  formId: UUID;
  filename: string;
  columns: string[];
  rows: Record<string, string>[];
}

let fallbackCounter = 0;

export function newId(): UUID {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  fallbackCounter += 1;
  const hex = (n: number, w: number) => n.toString(16).padStart(w, "0").slice(-w);
  const r = () => Math.floor(Math.random() * 0x10000);
  return `${hex(r(), 4)}${hex(r(), 4)}-${hex(r(), 4)}-4${hex(r(), 3)}-a${hex(r(), 3)}-${hex(fallbackCounter, 4)}${hex(r(), 4)}${hex(r(), 4)}`;
}

/** Like the API's timestamps: UTC, no milliseconds. */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export class DemoStore {
  readonly fixture: DemoFixture;
  readonly access: DemoAccess;
  org: Organization;
  members: Maybe<Member[]>;
  invitations: Maybe<Invitation[]>;
  groups: Maybe<Group[]>;
  staff: Maybe<Record<UUID, Maybe<StaffAssignment[]>>>;
  athletes: Maybe<Athlete[]>;
  forms: Maybe<Form[]>;
  versions: Record<UUID, Maybe<FormVersion[]>>;
  schedules: Record<UUID, Maybe<FormSchedule[]>>;
  submissions: Maybe<Submission[]>;
  imports: Maybe<ImportBatch[]>;
  metrics: Maybe<MetricDefinition[]>;
  seriesSources: Maybe<SeriesSource[]>;
  readonly uploads = new Map<UUID, DemoUpload>();
  /** Metric slugs created or redefined in the demo (their precomputed series no longer apply). */
  readonly changedMetrics = new Set<string>();
  private seriesIndex = new Map<string, Map<string, CompactPoint>>();
  private boardIndex = new Map<string, Map<UUID, ReadinessRow>>();

  constructor(fixture: DemoFixture) {
    const f = clone(fixture);
    this.fixture = f;
    this.access = f.access;
    this.org = f.org;
    this.members = f.members;
    this.invitations = f.invitations;
    this.groups = f.groups;
    this.staff = f.staff;
    this.athletes = f.athletes;
    this.forms = f.forms;
    this.versions = f.form_versions;
    this.schedules = f.schedules;
    this.submissions = f.submissions;
    this.imports = f.imports;
    this.metrics = f.metrics;
    this.seriesSources = f.series_sources;
  }

  get orgId(): UUID {
    return this.org.id;
  }

  get userId(): UUID {
    return this.fixture.me.user.id;
  }

  get timezone(): string {
    return isValidTimeZone(this.org.timezone) ? this.org.timezone : "UTC";
  }

  today(): string {
    return todayInTimeZone(this.timezone);
  }

  /** The calendar day of an instant for an athlete (their time zone, else the org's). */
  localDate(instant: string, athlete: Athlete): string {
    const tz = athlete.timezone && isValidTimeZone(athlete.timezone) ? athlete.timezone : this.timezone;
    return dateInTimeZone(instant, tz);
  }

  // ------------------------------------------------------------------ roles
  get isAdmin(): boolean {
    return this.access.is_admin;
  }

  get isAthlete(): boolean {
    return this.access.role === "athlete";
  }

  requireAdmin(): void {
    if (!this.isAdmin) throw fail(403, "admin role required");
  }

  requireStaff(): void {
    if (this.isAthlete) throw fail(403, "staff role required");
  }

  rights(athleteId: UUID): AthleteAccess | null {
    if (this.isAdmin) return { identifiable: true, write: true, read: ["general", "medical", "research"], write_forms: ["general", "medical", "research"] };
    return this.access.athletes[athleteId] ?? null;
  }

  canWriteFormData(form: Form, athleteId: UUID): boolean {
    if (this.isAdmin) return true;
    if (this.isAthlete) return athleteId === this.access.athlete_id && form.athlete_can_submit;
    return this.rights(athleteId)?.write_forms.includes(form.sensitivity) ?? false;
  }

  canWriteFormSomewhere(form: Form): boolean {
    if (this.isAthlete) return form.athlete_can_submit;
    return this.access.writable_sensitivities.includes(form.sensitivity);
  }

  canWriteGroup(groupId: UUID): boolean {
    return this.isAdmin || (this.access.writable_group_ids ?? []).includes(groupId);
  }

  // ------------------------------------------------------------------ lookups
  athleteList(): Athlete[] {
    return orElse(this.athletes, []);
  }

  athlete(id: UUID): Athlete {
    const a = this.athleteList().find((x) => x.id === id);
    if (!a) throw fail(404, "athlete not found");
    return a;
  }

  groupList(): Group[] {
    return orElse(this.groups, []);
  }

  group(id: UUID, what = "group not found"): Group {
    const g = this.groupList().find((x) => x.id === id);
    if (!g) throw fail(404, what);
    return g;
  }

  /** The group and every group below it. */
  descendants(groupId: UUID): Set<UUID> {
    const out = new Set<UUID>([groupId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const g of this.groupList()) {
        if (g.parent_id && out.has(g.parent_id) && !out.has(g.id)) {
          out.add(g.id);
          grew = true;
        }
      }
    }
    return out;
  }

  /**
   * Athletes currently in the group or a group below it. A group this login cannot list (a
   * filter remembered from another role) still filters by the athletes' memberships, as the API does.
   */
  athleteIdsInGroup(groupId: UUID): Set<UUID> {
    const groups = this.descendants(groupId);
    return new Set(this.athleteList().filter((a) => a.group_ids.some((g) => groups.has(g))).map((a) => a.id));
  }

  groupWithCount(g: Group): Group {
    const count = this.athleteList().filter((a) => a.status !== "archived" && a.group_ids.includes(g.id)).length;
    return { ...g, athlete_count: count };
  }

  formList(): Form[] {
    return orElse(this.forms, []);
  }

  form(id: UUID): Form {
    const f = this.formList().find((x) => x.id === id);
    if (!f) throw fail(404, "form not found");
    return f;
  }

  versionList(formId: UUID): FormVersion[] {
    return orElse(this.versions[formId], []);
  }

  version(versionId: UUID, formId: UUID): FormVersion | undefined {
    const form = this.formList().find((f) => f.id === formId);
    if (form?.current_version?.id === versionId) return form.current_version;
    return this.versionList(formId).find((v) => v.id === versionId);
  }

  submissionList(): Submission[] {
    return orElse(this.submissions, []);
  }

  memberList(): Member[] {
    return orElse(this.members, []);
  }

  metricList(): MetricDefinition[] {
    return orElse(this.metrics, []);
  }

  metric(slug: string): MetricDefinition {
    const m = this.metricList().find((x) => x.slug === slug);
    if (!m) throw fail(404, "metric not found");
    return m;
  }

  // ------------------------------------------------------------------ precomputed series and boards
  /** The recorded error for this metric × athlete, if the API refused it. */
  seriesError(slug: string, athleteId: UUID): FixtureError | null {
    const points = this.fixture.series.points;
    if (isFixtureError(points)) return points;
    const v = points[slug]?.[athleteId];
    return v !== undefined && isFixtureError(v) ? v : null;
  }

  /** Precomputed point of a metric for an athlete on a day (none for metrics changed in the demo). */
  point(slug: string, athleteId: UUID, date: string): CompactPoint | undefined {
    if (this.changedMetrics.has(slug)) return undefined;
    const key = `${slug}\u0000${athleteId}`;
    let byDate = this.seriesIndex.get(key);
    if (!byDate) {
      byDate = new Map();
      const all = this.fixture.series.points;
      const list = isFixtureError(all) ? undefined : all[slug]?.[athleteId];
      if (Array.isArray(list)) for (const p of list) byDate.set(p[0], p);
      this.seriesIndex.set(key, byDate);
    }
    return byDate.get(date);
  }

  /** The exported board row for an athlete (group board first, then the all-groups board). */
  boardRow(groupKey: string, date: string, athleteId: UUID): ReadinessRow | undefined {
    const key = `${groupKey}\u0000${date}`;
    let rows = this.boardIndex.get(key);
    if (!rows) {
      rows = new Map();
      const boards = this.fixture.readiness;
      const board: Maybe<ReadinessBoard> | undefined = isFixtureError(boards) ? undefined : boards[groupKey]?.[date];
      if (board && !isFixtureError(board)) for (const r of board.rows) rows.set(r.athlete.id, r);
      this.boardIndex.set(key, rows);
    }
    return rows.get(athleteId);
  }

  /** Dates with exported boards, oldest first. */
  boardDates(): string[] {
    const boards = this.fixture.readiness;
    if (isFixtureError(boards)) return [];
    return Object.keys(boards.all ?? {}).sort();
  }
}
