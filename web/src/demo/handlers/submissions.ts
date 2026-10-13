/** Submissions: list, create (single and bulk), edit, delete and the CSV export. */
import {
  calculatedFields,
  inputFields,
  isISODate,
  isValidDateTimeString,
  validateSubmission,
  type Athlete,
  type Form,
  type Submission,
  type SubmissionSource,
  type UUID,
} from "@ams/shared";
import { writeCsv } from "../csv";
import { HttpError, fail, has, invalidBody, json, noContent, paginate, replay, type DemoResponse } from "../http";
import { route, type Ctx, type RouteDef } from "../router";
import { newId, nowIso, type DemoStore } from "../store";

const ORG = "/orgs/:org";

export class InvalidSubmission extends Error {
  readonly fieldErrors: Record<string, string>;
  constructor(fieldErrors: Record<string, string>) {
    super("invalid submission");
    this.fieldErrors = fieldErrors;
  }
}

export class DuplicateSubmission extends Error {}

function invalid(fieldErrors: Record<string, string>): HttpError {
  return fail(422, { message: "invalid submission", field_errors: fieldErrors });
}

const DUPLICATE = "a submission for this form already exists for that local_date";

function hasSubmissionOn(store: DemoStore, formId: UUID, athleteId: UUID, day: string, exclude?: UUID): boolean {
  return store
    .submissionList()
    .some((s) => s.form_id === formId && s.athlete_id === athleteId && s.local_date === day && s.id !== exclude);
}

export interface CreateOptions {
  store: DemoStore;
  form: Form;
  athlete: Athlete;
  values: unknown;
  source: SubmissionSource;
  observedAt?: string | null;
  localDate?: string | null;
  importBatchId?: UUID | null;
  /** Batch callers (bulk, imports) detect duplicates inside the batch with this. */
  pending?: Set<string>;
  dryRun?: boolean;
}

/**
 * Validates against the form's current version with the shared engine (the same rules as
 * the API's), computes calculated fields and stores the submission (unless `dryRun`).
 * Throws `InvalidSubmission` / `DuplicateSubmission`, or an `HttpError` for an archived or
 * unpublished form.
 */
export function createSubmission(o: CreateOptions): Submission {
  const { store, form, athlete } = o;
  if (form.archived) throw fail(400, "form is archived");
  const version = form.current_version;
  if (!version) throw fail(409, "form has no published version");
  const result = validateSubmission(version.schema, o.values as Record<string, unknown>);
  if (!result.ok) throw new InvalidSubmission(result.errors);
  const observed = o.observedAt ?? nowIso();
  const day = o.localDate ?? store.localDate(observed, athlete);
  if (!form.allow_multiple_per_day) {
    const key = `${athlete.id}\u0000${day}`;
    if (hasSubmissionOn(store, form.id, athlete.id, day) || o.pending?.has(key)) throw new DuplicateSubmission();
    o.pending?.add(key);
  }
  const now = nowIso();
  const sub: Submission = {
    id: newId(),
    org_id: store.orgId,
    form_id: form.id,
    form_version_id: version.id,
    form_version: version.version,
    athlete_id: athlete.id,
    athlete_display_name: athlete.display_name,
    submitted_by: store.userId,
    observed_at: observed,
    local_date: day,
    values: result.values,
    computed: result.computed,
    source: o.source,
    import_batch_id: o.importBatchId ?? null,
    created_at: now,
    updated_at: now,
  };
  if (!o.dryRun) replay(store.submissions).push(sub);
  return sub;
}

function checkDates(body: Record<string, unknown>): { observedAt: string | null; localDate: string | null } {
  const observedAt = has(body, "observed_at") && body.observed_at !== null ? body.observed_at : null;
  const localDate = has(body, "local_date") && body.local_date !== null ? body.local_date : null;
  if (observedAt !== null && (typeof observedAt !== "string" || !isValidDateTimeString(observedAt))) {
    throw invalidBody("observed_at", "Input should be a valid datetime", "datetime_from_date_parsing");
  }
  if (localDate !== null && (typeof localDate !== "string" || !isISODate(localDate))) {
    throw invalidBody("local_date", "Input should be a valid date", "date_from_datetime_parsing");
  }
  return { observedAt: observedAt as string | null, localDate: localDate as string | null };
}

function valuesOf(body: Record<string, unknown>, required: boolean): Record<string, unknown> | undefined {
  const v = body.values;
  if (v === undefined || v === null) {
    if (required) throw invalidBody("values", "Field required", "missing");
    return undefined;
  }
  if (typeof v !== "object" || Array.isArray(v)) throw invalidBody("values", "Input should be a valid dictionary", "dict_type");
  return v as Record<string, unknown>;
}

/** The submission with the athlete's current display name (the API computes it on read). */
function out(store: DemoStore, s: Submission): Submission {
  const a = store.athleteList().find((x) => x.id === s.athlete_id);
  return a && a.display_name !== s.athlete_display_name ? { ...s, athlete_display_name: a.display_name } : s;
}

const newestFirst = (a: Submission, b: Submission) =>
  b.local_date.localeCompare(a.local_date) || b.observed_at.localeCompare(a.observed_at) || b.created_at.localeCompare(a.created_at);

/** Submissions matching the list/export filters (unsorted). */
export function filterSubmissions(store: DemoStore, q: URLSearchParams, list = store.submissionList()): Submission[] {
  const formId = q.get("form_id");
  const athleteId = q.get("athlete_id");
  const groupId = q.get("group_id");
  const start = q.get("start");
  const end = q.get("end");
  const source = q.get("source");
  let members: Set<UUID> | null = null;
  if (groupId) members = store.athleteIdsInGroup(groupId);
  return list.filter(
    (s) =>
      (!formId || s.form_id === formId) &&
      (!athleteId || s.athlete_id === athleteId) &&
      (!members || members.has(s.athlete_id)) &&
      (!start || s.local_date >= start) &&
      (!end || s.local_date <= end) &&
      (!source || s.source === source),
  );
}

export function listResponse(store: DemoStore, items: Submission[], q: URLSearchParams): DemoResponse {
  const page = paginate([...items].sort(newestFirst), q);
  return json({ items: page.items.map((s) => out(store, s)), total: page.total });
}

function getSubmission(store: DemoStore, id: UUID): Submission {
  const s = store.submissionList().find((x) => x.id === id);
  if (!s) throw fail(404, "submission not found");
  return s;
}

function create({ store, body: getBody }: Ctx) {
  const body = getBody();
  const formId = body.form_id;
  const athleteId = body.athlete_id;
  if (typeof formId !== "string") throw invalidBody("form_id", "Field required", "missing");
  if (typeof athleteId !== "string") throw invalidBody("athlete_id", "Field required", "missing");
  const values = valuesOf(body, true)!;
  const { observedAt, localDate } = checkDates(body);
  const form = store.form(formId);
  const athlete = store.athlete(athleteId);
  if (!store.canWriteFormData(form, athlete.id)) throw fail(403, "write access to this form for this athlete required");
  try {
    const sub = createSubmission({ store, form, athlete, values, source: store.isAthlete ? "mobile" : "web", observedAt, localDate });
    return json(sub, 201);
  } catch (e) {
    if (e instanceof InvalidSubmission) throw invalid(e.fieldErrors);
    if (e instanceof DuplicateSubmission) throw fail(409, DUPLICATE);
    throw e;
  }
}

function bulkCreate({ store, body: getBody }: Ctx) {
  const body = getBody();
  if (typeof body.form_id !== "string") throw invalidBody("form_id", "Field required", "missing");
  if (typeof body.local_date !== "string" || !isISODate(body.local_date)) throw invalidBody("local_date", "Input should be a valid date", "date_type");
  const { observedAt } = checkDates({ observed_at: body.observed_at });
  const form = store.form(body.form_id);
  if (!form.current_version) throw fail(409, "form has no published version");
  if (form.archived) throw fail(400, "form is archived");
  const entries = Array.isArray(body.entries) ? (body.entries as { athlete_id?: unknown; values?: unknown }[]) : [];
  const created: Submission[] = [];
  const errors: { athlete_id: string; field_errors: Record<string, string> }[] = [];
  const pending = new Set<string>();
  for (const entry of entries) {
    const id = String(entry.athlete_id);
    const athlete = store.athleteList().find((a) => a.id === id);
    if (!athlete) {
      errors.push({ athlete_id: id, field_errors: { athlete_id: "not_found" } });
      continue;
    }
    if (!store.canWriteFormData(form, athlete.id)) {
      errors.push({ athlete_id: id, field_errors: { athlete_id: "forbidden" } });
      continue;
    }
    try {
      created.push(
        createSubmission({ store, form, athlete, values: entry.values ?? {}, source: "web", observedAt, localDate: body.local_date, pending }),
      );
    } catch (e) {
      if (e instanceof InvalidSubmission) errors.push({ athlete_id: id, field_errors: e.fieldErrors });
      else if (e instanceof DuplicateSubmission) errors.push({ athlete_id: id, field_errors: { local_date: "duplicate" } });
      else throw e;
    }
  }
  return json({ created, errors });
}

function update({ store, params, body: getBody }: Ctx) {
  const sub = getSubmission(store, params.id!);
  const form = store.form(sub.form_id);
  const athlete = store.athlete(sub.athlete_id);
  if (!store.canWriteFormData(form, athlete.id)) throw fail(403, "write access required");
  const body = getBody();
  const values = valuesOf(body, false);
  const { observedAt, localDate } = checkDates(body);
  const before = sub.local_date;
  const next = { ...sub };
  if (values !== undefined) {
    const version = store.version(sub.form_version_id, sub.form_id);
    if (!version) throw fail(409, "form version not found");
    const result = validateSubmission(version.schema, values);
    if (!result.ok) throw invalid(result.errors);
    next.values = result.values;
    next.computed = result.computed;
  }
  if (observedAt !== null) {
    next.observed_at = observedAt;
    if (localDate === null) next.local_date = store.localDate(observedAt, athlete);
  }
  if (localDate !== null) next.local_date = localDate;
  if (!form.allow_multiple_per_day && next.local_date !== before && hasSubmissionOn(store, form.id, athlete.id, next.local_date, sub.id)) {
    throw fail(409, DUPLICATE);
  }
  next.updated_at = nowIso();
  Object.assign(sub, next);
  return json(out(store, sub));
}

// ---------------------------------------------------------------------------- export

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map(cell).join(";");
  if (typeof value === "object") return JSON.stringify(sortObject(value as Record<string, unknown>));
  return String(value);
}

function sortObject(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) out[k] = v[k];
  return out;
}

/** Field and calculated columns: the latest version's order, then extra keys seen in older data. */
function exportColumns(store: DemoStore, form: Form, rows: Submission[]): { fields: string[]; calcs: string[] } {
  const versions = [...store.versionList(form.id)];
  if (form.current_version && !versions.some((v) => v.id === form.current_version!.id)) versions.push(form.current_version);
  versions.sort((a, b) => b.version - a.version);
  const fields: string[] = [];
  const calcs: string[] = [];
  for (const v of versions) {
    for (const f of inputFields(v.schema)) if (!fields.includes(f.key)) fields.push(f.key);
    for (const c of calculatedFields(v.schema)) if (!calcs.includes(c.key)) calcs.push(c.key);
  }
  for (const s of rows) {
    for (const k of Object.keys(s.values ?? {})) if (!fields.includes(k) && !calcs.includes(k)) fields.push(k);
    for (const k of Object.keys(s.computed ?? {})) if (!calcs.includes(k) && !fields.includes(k)) calcs.push(k);
  }
  return { fields, calcs };
}

function exportCsv({ store, req }: Ctx): DemoResponse {
  const q = req.query;
  const formId = q.get("form_id");
  if (!formId) throw new HttpError(422, { detail: [{ loc: ["query", "form_id"], msg: "Field required", type: "missing" }] });
  const form = store.form(formId);
  const scoped = new URLSearchParams(q);
  scoped.delete("athlete_id");
  scoped.delete("source");
  const rows = filterSubmissions(store, scoped).sort(
    (a, b) => a.local_date.localeCompare(b.local_date) || a.observed_at.localeCompare(b.observed_at) || a.created_at.localeCompare(b.created_at),
  );
  const athletes = new Map(store.athleteList().map((a) => [a.id, a]));
  const deidentified = q.get("deidentified") === "true";
  let includeName: boolean;
  if (deidentified) includeName = false;
  else if (rows.length > 0) includeName = rows.every((s) => athletes.get(s.athlete_id)?.masked === false);
  else includeName = store.isAdmin || store.isAthlete || (store.access.identifiable_group_ids ?? []).length > 0;
  const { fields, calcs } = exportColumns(store, form, rows);
  const header = ["submission_id", "athlete_code", ...(includeName ? ["athlete_name"] : []), "local_date", "observed_at", "source", "form_version", ...fields, ...calcs];
  const lines: string[][] = [header];
  for (const s of rows) {
    const a = athletes.get(s.athlete_id);
    lines.push([
      s.id,
      a?.code ?? "",
      ...(includeName ? [a?.display_name ?? s.athlete_display_name] : []),
      s.local_date,
      s.observed_at.replace(/Z$/, "+00:00"), // Python's isoformat, as in the API's export
      s.source,
      String(s.form_version),
      ...fields.map((k) => cell(s.values?.[k])),
      ...calcs.map((k) => cell(s.computed?.[k])),
    ]);
  }
  return { status: 200, text: writeCsv(lines), contentType: "text/csv; charset=utf-8" };
}

export const submissionRoutes: RouteDef[] = [
  route("GET", `${ORG}/submissions`, ({ store, req }) => listResponse(store, filterSubmissions(store, req.query), req.query)),
  route("POST", `${ORG}/submissions`, create),
  route("POST", `${ORG}/submissions/bulk`, bulkCreate),
  route("GET", `${ORG}/submissions/export`, exportCsv),
  route("GET", `${ORG}/submissions/:id`, ({ store, params }) => json(out(store, getSubmission(store, params.id!)))),
  route("PATCH", `${ORG}/submissions/:id`, update),
  route("DELETE", `${ORG}/submissions/:id`, ({ store, params }) => {
    const sub = getSubmission(store, params.id!);
    if (!store.canWriteFormData(store.form(sub.form_id), sub.athlete_id)) throw fail(403, "write access required");
    const list = replay(store.submissions);
    list.splice(list.indexOf(sub), 1);
    return noContent();
  }),
];
