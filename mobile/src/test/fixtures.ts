import type {
  Athlete,
  DueForm,
  Form,
  FormSchema,
  Me,
  Membership,
  MetricSeries,
  Organization,
  Submission,
  WearableProvider,
  WearableStatus,
} from "@ams/shared";
import formCases from "../../../spec/form-cases.json";
import type { ActiveMembership } from "../lib/session/membership";

export const ORG_ID = "org-1";
export const ATHLETE_ID = "ath-1";

export const SPEC = formCases as unknown as {
  schemas: Record<"wellness" | "session" | "types", FormSchema>;
  cases: {
    name: string;
    schema: "wellness" | "session" | "types";
    values: Record<string, unknown>;
    expected: {
      ok: boolean;
      errors: Record<string, string>;
      values: Record<string, unknown>;
      computed: Record<string, unknown>;
      hidden: string[];
    };
  }[];
};

export const org: Organization = {
  id: ORG_ID,
  name: "Riverside Rowing",
  slug: "riverside",
  timezone: "UTC",
  settings: {
    terminology: { athlete: "Rower", athletes: "Rowers", group: "Crew", groups: "Crews" },
    readiness_metrics: [],
  },
  created_at: "2026-01-01T00:00:00Z",
};

export const membership: Membership = { org, role: "athlete", athlete_id: ATHLETE_ID };

export const activeMembership: ActiveMembership = {
  orgId: ORG_ID,
  athleteId: ATHLETE_ID,
  org,
  role: "athlete",
  terminology: { athlete: "Rower", athletes: "Rowers", group: "Crew", groups: "Crews" },
};

export const me: Me = {
  user: { id: "user-1", email: "sam@example.org", full_name: "Sam Lee", is_active: true, created_at: "2026-01-01T00:00:00Z" },
  memberships: [membership],
};

export const athlete: Athlete = {
  id: ATHLETE_ID,
  org_id: ORG_ID,
  code: "R-014",
  first_name: "Samantha",
  last_name: "Lee",
  preferred_name: "Sam",
  email: "sam@example.org",
  date_of_birth: null,
  display_name: "Sam Lee",
  masked: false,
  sex: null,
  position: null,
  timezone: null,
  status: "active",
  attributes: {},
  group_ids: [],
  user_id: "user-1",
  ow_user_id: null,
  created_at: "2026-01-01T00:00:00Z",
};

export function makeForm(id: string, name: string, schema: FormSchema, overrides: Partial<Form> = {}): Form {
  return {
    id,
    org_id: ORG_ID,
    slug: id,
    name,
    description: null,
    kind: "questionnaire",
    sensitivity: "general",
    athlete_can_submit: true,
    athlete_can_view: true,
    allow_multiple_per_day: false,
    draft_schema: schema,
    current_version: null,
    archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeDueForm(
  id: string,
  name: string,
  schema: FormSchema,
  overrides: Partial<Omit<DueForm, "form">> & { form?: Partial<Form> } = {},
): DueForm {
  const { form: formOverrides, ...rest } = overrides;
  const form = makeForm(id, name, schema, formOverrides);
  return {
    form,
    version: { id: `${id}-v1`, form_id: id, version: 1, schema, published_at: "2026-01-01T00:00:00Z" },
    due_time: null,
    completed: false,
    last_submitted_at: null,
    ...rest,
  };
}

export function makeSubmission(formId: string, overrides: Partial<Submission> = {}): Submission {
  return {
    id: `sub-${formId}`,
    org_id: ORG_ID,
    form_id: formId,
    form_version_id: `${formId}-v1`,
    form_version: 1,
    athlete_id: ATHLETE_ID,
    athlete_display_name: "Sam Lee",
    submitted_by: "user-1",
    observed_at: "2026-10-12T07:05:00Z",
    local_date: "2026-10-12",
    values: {},
    computed: {},
    source: "mobile",
    import_batch_id: null,
    created_at: "2026-10-12T07:05:00Z",
    updated_at: "2026-10-12T07:05:00Z",
    ...overrides,
  };
}

export const providers: WearableProvider[] = [
  { provider: "garmin", name: "Garmin", enabled: true, kind: "cloud", icon_url: null },
  { provider: "oura", name: "Oura", enabled: true, kind: "cloud", icon_url: null },
  { provider: "whoop", name: "Whoop", enabled: false, kind: "cloud", icon_url: null },
  { provider: "apple", name: "Apple Health", enabled: true, kind: "sdk", icon_url: null },
];

export const emptyWearables: WearableStatus = { linked: true, ow_user_id: "ow-1", connections: [] };

export function metricSeries(slug: string, name: string, values: (number | null)[]): MetricSeries {
  return {
    athlete_id: ATHLETE_ID,
    metric: {
      id: `m-${slug}`,
      org_id: ORG_ID,
      slug,
      name,
      description: "How you feel overall.",
      unit: "AU",
      source: "form:wellness.hooper_total",
      daily_agg: "last",
      fill_zero: false,
      transform: "none",
      params: {},
      thresholds: { direction: "high_bad", amber: 16, red: 20 },
      decimals: 0,
      athlete_visible: true,
      builtin: true,
    },
    points: values.map((value, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      value,
      flag: value === null ? null : value >= 20 ? "red" : value >= 16 ? "amber" : "green",
      source: null,
    })),
  };
}
