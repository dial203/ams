/**
 * TanStack Query key factory (plain arrays; no dependency on TanStack).
 *
 * Keys are hierarchical so prefixes can be invalidated:
 *   queryKeys.org(orgId)               everything in an org
 *   queryKeys.athletes.all(orgId)      every athlete list and detail
 *   queryKeys.athletes.lists(orgId)    every athlete list, any params
 *   queryKeys.athletes.list(orgId, p)  one list
 *   queryKeys.athletes.detail(orgId, id)
 *
 * Params objects are normalised (null/undefined dropped, keys sorted) so equal params
 * give equal keys.
 */
import type {
  AthleteListParams,
  AuditListParams,
  DateRangeParams,
  FormListParams,
  GroupListParams,
  ImportListParams,
  MetricSeriesParams,
  ReadinessParams,
  SelfFormsParams,
  SelfSubmissionListParams,
  SubmissionListParams,
  UUID,
  WearableDailyParams,
} from "./types";

export type QueryKey = readonly unknown[];

const ROOT = "ams" as const;

/** Drops null/undefined values and sorts keys. */
export function normalizeParams(params: object | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!params) return out;
  const rec = params as Record<string, unknown>;
  for (const k of Object.keys(rec).sort()) {
    const v = rec[k];
    if (v !== undefined && v !== null) out[k] = Array.isArray(v) ? v.slice() : v;
  }
  return out;
}

const org = (orgId: UUID) => [ROOT, "org", orgId] as const;

/** `all`, `lists`, `list(params)` and `detail(id)` for an org-scoped resource. */
function resource<P extends object>(name: string) {
  const all = (orgId: UUID) => [...org(orgId), name] as const;
  return {
    all,
    lists: (orgId: UUID) => [...all(orgId), "list"] as const,
    list: (orgId: UUID, params?: P | null) => [...all(orgId), "list", normalizeParams(params)] as const,
    detail: (orgId: UUID, id: UUID) => [...all(orgId), "detail", id] as const,
  };
}

const athletes = resource<AthleteListParams>("athletes");
const groups = resource<GroupListParams>("groups");
const forms = resource<FormListParams>("forms");
const submissions = resource<SubmissionListParams>("submissions");

export const queryKeys = {
  all: () => [ROOT] as const,
  /** `GET /me` */
  me: () => [ROOT, "me"] as const,
  /** `GET /auth/invite/{token}` */
  invite: (token: string) => [ROOT, "invite", token] as const,
  /** Prefix of every org-scoped key. */
  org,

  orgs: {
    detail: (orgId: UUID) => [...org(orgId), "detail"] as const,
  },
  members: {
    all: (orgId: UUID) => [...org(orgId), "members"] as const,
    list: (orgId: UUID) => [...org(orgId), "members", "list"] as const,
  },
  invitations: {
    all: (orgId: UUID) => [...org(orgId), "invitations"] as const,
    list: (orgId: UUID) => [...org(orgId), "invitations", "list"] as const,
  },
  groups: {
    ...groups,
    staff: (orgId: UUID, groupId: UUID) => [...groups.detail(orgId, groupId), "staff"] as const,
  },
  athletes,
  forms: {
    ...forms,
    versions: (orgId: UUID, formId: UUID) => [...forms.detail(orgId, formId), "versions"] as const,
    schedules: (orgId: UUID, formId: UUID) => [...forms.detail(orgId, formId), "schedules"] as const,
  },
  formTemplates: {
    list: (orgId: UUID) => [...org(orgId), "form-templates", "list"] as const,
  },
  submissions,
  imports: {
    all: (orgId: UUID) => [...org(orgId), "imports"] as const,
    list: (orgId: UUID, params?: ImportListParams | null) =>
      [...org(orgId), "imports", "list", normalizeParams(params)] as const,
  },
  /** Athlete self-service (`/orgs/{org_id}/me/*`). */
  self: {
    all: (orgId: UUID) => [...org(orgId), "self"] as const,
    athlete: (orgId: UUID) => [...org(orgId), "self", "athlete"] as const,
    forms: (orgId: UUID, params?: SelfFormsParams | null) =>
      [...org(orgId), "self", "forms", normalizeParams(params)] as const,
    submissions: (orgId: UUID, params?: SelfSubmissionListParams | null) =>
      [...org(orgId), "self", "submissions", normalizeParams(params)] as const,
    metrics: (orgId: UUID, params?: DateRangeParams | null) =>
      [...org(orgId), "self", "metrics", normalizeParams(params)] as const,
    wearables: (orgId: UUID) => [...org(orgId), "self", "wearables"] as const,
    wearableProviders: (orgId: UUID) => [...org(orgId), "self", "wearables", "providers"] as const,
  },
  /** Staff wearable views. */
  wearables: {
    all: (orgId: UUID) => [...org(orgId), "wearables"] as const,
    providers: (orgId: UUID) => [...org(orgId), "wearables", "providers"] as const,
    athlete: (orgId: UUID, athleteId: UUID) => [...org(orgId), "wearables", "athlete", athleteId] as const,
    status: (orgId: UUID, athleteId: UUID) =>
      [...org(orgId), "wearables", "athlete", athleteId, "status"] as const,
    daily: (orgId: UUID, athleteId: UUID, params?: WearableDailyParams | null) =>
      [...org(orgId), "wearables", "athlete", athleteId, "daily", normalizeParams(params)] as const,
  },
  metrics: {
    all: (orgId: UUID) => [...org(orgId), "metrics"] as const,
    list: (orgId: UUID) => [...org(orgId), "metrics", "list"] as const,
    seriesSources: (orgId: UUID) => [...org(orgId), "metrics", "series-sources"] as const,
    allSeries: (orgId: UUID) => [...org(orgId), "metrics", "series"] as const,
    series: (orgId: UUID, slug: string, params: MetricSeriesParams) =>
      [...org(orgId), "metrics", "series", slug, normalizeParams(params)] as const,
  },
  dashboards: {
    all: (orgId: UUID) => [...org(orgId), "dashboards"] as const,
    readiness: (orgId: UUID, params?: ReadinessParams | null) =>
      [...org(orgId), "dashboards", "readiness", normalizeParams(params)] as const,
  },
  audit: {
    all: (orgId: UUID) => [...org(orgId), "audit"] as const,
    list: (orgId: UUID, params?: AuditListParams | null) =>
      [...org(orgId), "audit", "list", normalizeParams(params)] as const,
  },
};
