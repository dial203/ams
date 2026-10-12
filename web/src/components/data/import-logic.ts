import { inputFields, type AthleteMatch, type FormSchema, type ImportCommit, type ImportPreview } from "@ams/shared";

export interface MappingState {
  /** csv column -> field key ("" = ignored) */
  mapping: Record<string, string>;
  athleteColumn: string;
  athleteMatch: AthleteMatch;
  dateColumn: string;
  dateFormat: string;
  defaultDate: string;
  timezone: string;
}

export const ATHLETE_MATCH_LABELS: Record<AthleteMatch, string> = {
  code: "Code (e.g. A-0012)",
  email: "Email",
  name: "Full name",
  external_id: "External / vendor ID",
};

export const DATE_FORMAT_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Automatic (ISO 8601)" },
  { value: "%Y-%m-%d", label: "2026-10-12" },
  { value: "%d/%m/%Y", label: "12/10/2026 (day first)" },
  { value: "%m/%d/%Y", label: "10/12/2026 (month first)" },
  { value: "%d.%m.%Y", label: "12.10.2026" },
  { value: "%Y-%m-%d %H:%M", label: "2026-10-12 06:30" },
  { value: "%d/%m/%Y %H:%M", label: "12/10/2026 06:30" },
];

/** Initial state from the server's suggestions; suggested targets that are not input fields are dropped. */
export function initialMapping(preview: ImportPreview, schema: FormSchema, defaults: { today: string; timezone: string }): MappingState {
  const keys = new Set(inputFields(schema).map((f) => f.key));
  const mapping: Record<string, string> = {};
  for (const col of preview.columns) {
    const target = preview.suggested_mapping[col];
    mapping[col] = target && keys.has(target) && col !== preview.suggested_athlete_column && col !== preview.suggested_date_column ? target : "";
  }
  const athleteColumn = preview.suggested_athlete_column ?? "";
  return {
    mapping,
    athleteColumn,
    athleteMatch: guessMatch(athleteColumn, preview),
    dateColumn: preview.suggested_date_column ?? "",
    dateFormat: "",
    defaultDate: defaults.today,
    timezone: defaults.timezone,
  };
}

/** Guesses the athlete match strategy from the column name and sample values. */
export function guessMatch(column: string, preview: Pick<ImportPreview, "sample_rows">): AthleteMatch {
  const name = column.toLowerCase();
  const sample = preview.sample_rows.map((r) => r[column] ?? "").filter(Boolean);
  if (/mail/.test(name) || sample.some((v) => v.includes("@"))) return "email";
  if (/code/.test(name) || sample.every((v) => /^[A-Za-z]{1,4}-?\d{2,}$/.test(v.trim()))) return "code";
  if (/(^|_|\s)(id|external|vendor|player_id|athlete_id)(_|\s|$)/.test(name)) return "external_id";
  return "name";
}

export interface MappingIssues {
  athleteColumn?: string;
  date?: string;
  fields?: string;
  /** csv columns whose target field is also used by another column */
  duplicates: string[];
}

export function mappingIssues(state: MappingState): MappingIssues {
  const issues: MappingIssues = { duplicates: [] };
  if (!state.athleteColumn) issues.athleteColumn = "Choose the column that identifies the person";
  if (!state.dateColumn && !state.defaultDate) issues.date = "Choose a date column or a default date";
  const used = new Map<string, string[]>();
  for (const [col, key] of Object.entries(state.mapping)) {
    if (!key || col === state.athleteColumn || col === state.dateColumn) continue;
    used.set(key, [...(used.get(key) ?? []), col]);
  }
  if (used.size === 0) issues.fields = "Map at least one column to a field";
  for (const cols of used.values()) if (cols.length > 1) issues.duplicates.push(...cols);
  if (issues.duplicates.length) issues.fields = "Each field can only be filled from one column";
  return issues;
}

export function hasIssues(i: MappingIssues): boolean {
  return !!(i.athleteColumn || i.date || i.fields || i.duplicates.length);
}

/** The ImportCommit body (without upload_id / dry_run) for a mapping state. */
export function buildCommit(state: MappingState): Omit<ImportCommit, "upload_id" | "dry_run"> {
  const mapping: Record<string, string> = {};
  for (const [col, key] of Object.entries(state.mapping)) {
    if (key && col !== state.athleteColumn && col !== state.dateColumn) mapping[col] = key;
  }
  return {
    mapping,
    athlete_column: state.athleteColumn,
    athlete_match: state.athleteMatch,
    date_column: state.dateColumn || null,
    date_format: state.dateFormat.trim() || null,
    default_date: state.defaultDate || null,
    timezone: state.timezone || null,
  };
}
