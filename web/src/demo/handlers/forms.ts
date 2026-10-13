/** Forms, versions, templates and schedules. */
import {
  FORM_KINDS,
  SENSITIVITIES,
  allFields,
  emptySchema,
  validateSchema,
  type Form,
  type FormKind,
  type FormSchedule,
  type FormSchema,
  type FormVersion,
  type Recurrence,
  type Sensitivity,
} from "@ams/shared";
import { isFixtureError } from "../fixture";
import { fail, has, invalidBody, json, noContent, replay, requiredString } from "../http";
import { route, type RouteDef } from "../router";
import { clone, newId, nowIso, type DemoStore } from "../store";

const ORG = "/orgs/:org";

export function slugify(text: string, sep = "_"): string {
  const norm = text
    .normalize("NFKD")
    .replace(/[^ -~]/g, "")
    .toLowerCase();
  const re = new RegExp(`^\\${sep}+|\\${sep}+$`, "g");
  return norm.replace(/[^a-z0-9]+/g, sep).replace(re, "").slice(0, 90);
}

function slugTaken(store: DemoStore, slug: string, exclude?: string): boolean {
  return store.formList().some((f) => f.slug === slug && f.id !== exclude);
}

function uniqueSlug(store: DemoStore, base: string): string {
  let candidate = base;
  let n = 1;
  while (slugTaken(store, candidate)) {
    n += 1;
    candidate = `${base}_${n}`;
  }
  return candidate;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** Numeric, boolean and calculated fields become metric sources once a form is published. */
function addSeriesSources(store: DemoStore, form: Form): void {
  const sources = store.seriesSources;
  if (isFixtureError(sources) || !form.current_version) return;
  for (const { field } of allFields(form.current_version.schema)) {
    const f = field as { key: string; type: string; label?: string; unit?: string | null; options?: { value: unknown }[] };
    const numericSelect = f.type === "select" && (f.options ?? []).every((o) => typeof o.value === "number");
    if (!["number", "scale", "duration", "boolean", "calculated"].includes(f.type) && !numericSelect) continue;
    const ref = `form:${form.slug}.${f.key}`;
    if (sources.some((s) => s.ref === ref)) continue;
    sources.push({ ref, label: `${form.name}: ${f.label || f.key}`, unit: f.unit ?? null, kind: "form" });
  }
}

/** Publishes the draft like the API: 422 with schema_errors when invalid, no-op when unchanged. */
export function publish(store: DemoStore, form: Form): FormVersion {
  const draft = (form.draft_schema ?? emptySchema()) as FormSchema;
  const errors = validateSchema(draft);
  if (errors.length > 0) throw fail(422, { message: "invalid schema", schema_errors: errors });
  if (form.current_version && sameJson(form.current_version.schema, draft)) return form.current_version;
  let list = store.versions[form.id];
  if (!list || isFixtureError(list)) {
    list = [];
    store.versions[form.id] = list;
  }
  const latest = list.reduce((max, v) => Math.max(max, v.version), 0);
  const version: FormVersion = { id: newId(), form_id: form.id, version: latest + 1, schema: clone(draft), published_at: nowIso() };
  list.unshift(version);
  form.current_version = version;
  form.updated_at = version.published_at;
  addSeriesSources(store, form);
  return version;
}

function bool(body: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof body[key] === "boolean" ? (body[key] as boolean) : fallback;
}

function scheduleFields(store: DemoStore, body: Record<string, unknown>, s: FormSchedule): FormSchedule {
  for (const key of ["group_id", "recurrence", "due_time", "start_date", "remind", "active", "days_of_week"]) {
    if (has(body, key) && body[key] === null) throw fail(400, `${key} cannot be null`);
  }
  if (typeof body.group_id === "string") {
    store.group(body.group_id);
    s.group_id = body.group_id;
  }
  if (typeof body.recurrence === "string") {
    if (!["daily", "weekly", "once"].includes(body.recurrence)) throw invalidBody("recurrence", "Input should be 'daily', 'weekly' or 'once'", "enum");
    s.recurrence = body.recurrence as Recurrence;
  }
  if (Array.isArray(body.days_of_week)) s.days_of_week = body.days_of_week.map(Number).filter((d) => d >= 1 && d <= 7);
  if (typeof body.due_time === "string") s.due_time = body.due_time;
  if (typeof body.start_date === "string") s.start_date = body.start_date;
  if (has(body, "end_date")) s.end_date = (body.end_date as string | null) || null;
  if (typeof body.remind === "boolean") s.remind = body.remind;
  if (typeof body.active === "boolean") s.active = body.active;
  if (s.recurrence === "weekly" && s.days_of_week.length === 0) throw fail(400, "weekly schedules need days_of_week");
  if (s.end_date && s.end_date < s.start_date) throw fail(400, "end_date must not be before start_date");
  return s;
}

function schedulesOf(store: DemoStore, formId: string): FormSchedule[] {
  const v = store.schedules[formId];
  if (v === undefined || isFixtureError(v)) {
    if (isFixtureError(v)) replay(v);
    store.schedules[formId] = [];
    return store.schedules[formId] as FormSchedule[];
  }
  return v;
}

function findSchedule(store: DemoStore, id: string): { list: FormSchedule[]; schedule: FormSchedule } {
  for (const list of Object.values(store.schedules)) {
    if (!Array.isArray(list)) continue;
    const schedule = list.find((s) => s.id === id);
    if (schedule) return { list, schedule };
  }
  throw fail(404, "schedule not found");
}

export const formRoutes: RouteDef[] = [
  route("GET", `${ORG}/forms`, ({ store, req }) => {
    const kind = req.query.get("kind");
    const includeArchived = req.query.get("include_archived") === "true";
    const forms = replay(store.forms)
      .filter((f) => (!kind || f.kind === kind) && (includeArchived || !f.archived))
      .sort((a, b) => a.name.localeCompare(b.name));
    return json(forms);
  }),
  route("POST", `${ORG}/forms`, ({ store, body: getBody }) => {
    store.requireAdmin();
    const body = getBody();
    const name = requiredString(body, "name");
    const kind = body.kind as FormKind;
    if (!FORM_KINDS.includes(kind)) throw invalidBody("kind", "Input should be a form kind", "enum");
    const sensitivity = (body.sensitivity ?? "general") as Sensitivity;
    if (!SENSITIVITIES.includes(sensitivity)) throw invalidBody("sensitivity", "Input should be 'general', 'medical' or 'research'", "enum");
    const slug = typeof body.slug === "string" && body.slug ? body.slug : null;
    if (slug && slugTaken(store, slug)) throw fail(409, `form slug '${slug}' already exists`);
    const now = nowIso();
    const form: Form = {
      id: newId(),
      org_id: store.orgId,
      slug: slug ?? uniqueSlug(store, slugify(name) || "form"),
      name,
      description: typeof body.description === "string" && body.description ? body.description : null,
      kind,
      sensitivity,
      athlete_can_submit: bool(body, "athlete_can_submit", false),
      athlete_can_view: bool(body, "athlete_can_view", false),
      allow_multiple_per_day: bool(body, "allow_multiple_per_day", false),
      draft_schema: (body.draft_schema as FormSchema | undefined) ?? emptySchema(),
      current_version: null,
      archived: false,
      created_at: now,
      updated_at: now,
    };
    replay(store.forms).push(form);
    store.versions[form.id] = [];
    store.schedules[form.id] = [];
    return json(form, 201);
  }),
  route("POST", `${ORG}/forms/validate-schema`, ({ store, body: getBody }) => {
    store.requireAdmin();
    const errors = validateSchema(getBody().schema);
    return json({ valid: errors.length === 0, errors });
  }),
  route("GET", `${ORG}/forms/:id`, ({ store, params }) => json(store.form(params.id!))),
  route("PATCH", `${ORG}/forms/:id`, ({ store, params, body: getBody }) => {
    store.requireAdmin();
    const form = store.form(params.id!);
    const body = getBody();
    for (const key of ["name", "slug", "kind", "sensitivity", "draft_schema", "archived"]) {
      if (has(body, key) && body[key] === null) throw fail(400, `${key} cannot be null`);
    }
    if (typeof body.slug === "string" && slugTaken(store, body.slug, form.id)) throw fail(409, `form slug '${body.slug}' already exists`);
    const target = form as unknown as Record<string, unknown>;
    for (const key of ["name", "slug", "description", "kind", "sensitivity", "athlete_can_submit", "athlete_can_view", "allow_multiple_per_day", "draft_schema", "archived"]) {
      if (has(body, key)) target[key] = key === "draft_schema" ? clone(body[key]) : body[key];
    }
    form.updated_at = nowIso();
    return json(form);
  }),
  route("POST", `${ORG}/forms/:id/publish`, ({ store, params }) => {
    store.requireAdmin();
    return json(publish(store, store.form(params.id!)));
  }),
  route("GET", `${ORG}/forms/:id/versions`, ({ store, params }) => {
    store.form(params.id!);
    return json(replay(store.versions[params.id!] ?? []));
  }),

  // ---------------------------------------------------------------- templates
  route("GET", `${ORG}/form-templates`, ({ store }) => {
    store.requireAdmin();
    return json(replay(store.fixture.form_templates));
  }),
  route("POST", `${ORG}/form-templates/:key/install`, ({ store, params, req }) => {
    store.requireAdmin();
    const template = replay(store.fixture.form_templates).find((t) => t.key === params.key);
    if (!template) throw fail(404, "template not found");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const slug = typeof body.slug === "string" && body.slug ? body.slug : null;
    if (slug && slugTaken(store, slug)) throw fail(409, `form slug '${slug}' already exists`);
    const flags = store.fixture.template_settings[template.key] ?? {
      athlete_can_submit: false,
      athlete_can_view: false,
      allow_multiple_per_day: false,
    };
    const now = nowIso();
    const form: Form = {
      id: newId(),
      org_id: store.orgId,
      slug: slug ?? uniqueSlug(store, template.key),
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : template.name,
      description: template.description,
      kind: template.kind,
      sensitivity: template.sensitivity,
      ...flags,
      draft_schema: clone(template.schema),
      current_version: null,
      archived: false,
      created_at: now,
      updated_at: now,
    };
    replay(store.forms).push(form);
    store.versions[form.id] = [];
    store.schedules[form.id] = [];
    publish(store, form);
    return json(form, 201);
  }),

  // ---------------------------------------------------------------- schedules
  route("GET", `${ORG}/forms/:id/schedules`, ({ store, params }) => {
    store.form(params.id!);
    return json(schedulesOf(store, params.id!));
  }),
  route("POST", `${ORG}/forms/:id/schedules`, ({ store, params, body: getBody }) => {
    store.requireAdmin();
    const form = store.form(params.id!);
    const body = getBody();
    requiredString(body, "group_id");
    requiredString(body, "start_date");
    const s = scheduleFields(store, body, {
      id: newId(),
      form_id: form.id,
      group_id: "",
      recurrence: "daily",
      days_of_week: [],
      due_time: "09:00",
      start_date: store.today(),
      end_date: null,
      remind: true,
      active: true,
    });
    schedulesOf(store, form.id).push(s);
    return json(s, 201);
  }),
  route("PATCH", `${ORG}/form-schedules/:id`, ({ store, params, body: getBody }) => {
    store.requireAdmin();
    const { schedule } = findSchedule(store, params.id!);
    const copy = scheduleFields(store, getBody(), { ...schedule, days_of_week: [...schedule.days_of_week] });
    Object.assign(schedule, copy);
    return json(schedule);
  }),
  route("DELETE", `${ORG}/form-schedules/:id`, ({ store, params }) => {
    store.requireAdmin();
    const { list, schedule } = findSchedule(store, params.id!);
    list.splice(list.indexOf(schedule), 1);
    return noContent();
  }),
];
