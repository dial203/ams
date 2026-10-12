import type {
  FormSchedule,
  AccessRole,
  AthleteStatus,
  DailyAgg,
  FormKind,
  GroupKind,
  OrgRole,
  Recurrence,
  Sensitivity,
  SubmissionSource,
  Transform,
} from "@ams/shared";
import { formatDate } from "@/lib/field-format";

export const GROUP_KIND_LABELS: Record<GroupKind, string> = {
  team: "Team",
  squad: "Squad",
  unit: "Unit",
  section: "Section",
  study: "Study",
  cohort: "Cohort",
  other: "Other",
};

export const FORM_KIND_LABELS: Record<FormKind, string> = {
  questionnaire: "Questionnaire",
  session: "Session log",
  test: "Test",
  medical: "Medical",
  profile: "Profile",
  import: "Import",
};

export const SENSITIVITY_LABELS: Record<Sensitivity, string> = {
  general: "General",
  medical: "Medical",
  research: "Research",
};

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
  athlete: "Athlete",
};

export const ACCESS_ROLE_LABELS: Record<AccessRole, string> = {
  viewer: "Viewer",
  coach: "Coach",
  practitioner: "Practitioner",
  medical: "Medical",
  researcher: "Researcher",
};

export const ACCESS_ROLE_HINTS: Record<AccessRole, string> = {
  viewer: "Reads general forms, no writes",
  coach: "Reads and writes general forms",
  practitioner: "Reads and writes general forms",
  medical: "Adds medical forms",
  researcher: "Adds research forms",
};

export const STATUS_LABELS: Record<AthleteStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

export const SOURCE_LABELS: Record<SubmissionSource, string> = {
  mobile: "Mobile",
  web: "Web",
  import: "Import",
  api: "API",
};

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  daily: "Every day",
  weekly: "Weekly",
  once: "Once",
};

export const DAILY_AGG_LABELS: Record<DailyAgg, string> = {
  sum: "Sum",
  mean: "Mean",
  last: "Last",
  max: "Max",
  min: "Min",
};

export const TRANSFORM_LABELS: Record<Transform, string> = {
  none: "None (daily value)",
  rolling_mean: "Rolling mean",
  rolling_sum: "Rolling sum",
  ewma: "EWMA",
  acwr: "Acute:chronic ratio (ACWR)",
  zscore: "Z-score vs baseline",
  pct_change: "% change vs baseline",
  monotony: "Monotony",
  strain: "Strain",
};

export const WEEKDAYS = [
  { n: 1, short: "Mon" },
  { n: 2, short: "Tue" },
  { n: 3, short: "Wed" },
  { n: 4, short: "Thu" },
  { n: 5, short: "Fri" },
  { n: 6, short: "Sat" },
  { n: 7, short: "Sun" },
] as const;

export function describeRecurrence(s: Pick<FormSchedule, "recurrence" | "days_of_week" | "start_date">): string {
  if (s.recurrence === "daily") return "Every day";
  if (s.recurrence === "once") return `Once on ${formatDate(s.start_date)}`;
  const days = [...s.days_of_week].sort().map((d) => WEEKDAYS.find((w) => w.n === d)?.short ?? d);
  return days.length ? `Weekly: ${days.join(", ")}` : "Weekly (no days)";
}

