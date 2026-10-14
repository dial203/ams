import { validateSchema, type Athlete, type FormSchema, type Submission } from "@ams/shared";
import { describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "./accounts";
import { DemoBackend } from "./backend";
import { prepareFixture, type DemoFixture, type DemoRole } from "./fixture";
import type { DemoResponse } from "./http";

const ORG = "00000000-0000-4000-8000-000000000001";
const SPRINTS = "00000000-0000-4000-8000-0000000000a2";
const TEAM = "00000000-0000-4000-8000-0000000000a1";
const MAYA = "00000000-0000-4000-8000-0000000000b1";
const LEO = "00000000-0000-4000-8000-0000000000b2";
const WELLNESS = "00000000-0000-4000-8000-0000000000c1";
const INJURY = "00000000-0000-4000-8000-0000000000c2";
const DAY = "2026-10-12";

const schema: FormSchema = {
  schema_version: 1,
  sections: [
    {
      key: "main",
      title: "Main",
      fields: [
        { key: "sleep_quality", type: "scale", label: "Sleep quality", min: 1, max: 7, required: true },
        { key: "sleep_hours", type: "number", label: "Hours slept", min: 0, max: 24 },
        { key: "double", type: "calculated", label: "Double", expression: "sleep_quality * 2" },
      ],
    },
  ],
};

function athlete(id: string, code: string, first: string, last: string, masked = false): Athlete {
  return {
    id,
    org_id: ORG,
    code,
    first_name: masked ? null : first,
    last_name: masked ? null : last,
    preferred_name: null,
    email: masked ? null : `${first.toLowerCase()}@example.com`,
    date_of_birth: null,
    display_name: masked ? code : `${first} ${last}`,
    masked,
    sex: null,
    position: "100m",
    timezone: null,
    status: "active",
    attributes: { external_id: `EXT-${code}` },
    group_ids: [SPRINTS],
    user_id: null,
    ow_user_id: null,
    created_at: "2026-09-01T10:00:00Z",
  };
}

function form(id: string, slug: string, name: string, sensitivity: "general" | "medical") {
  const version = { id: `${id.slice(0, -2)}f1`, form_id: id, version: 1, schema, published_at: "2026-09-01T10:00:00Z" };
  return {
    id,
    org_id: ORG,
    slug,
    name,
    description: null,
    kind: "questionnaire" as const,
    sensitivity,
    athlete_can_submit: true,
    athlete_can_view: true,
    allow_multiple_per_day: false,
    draft_schema: schema,
    current_version: version,
    archived: false,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
  };
}

function submission(n: number, athleteId: string, day: string): Submission {
  return {
    id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
    org_id: ORG,
    form_id: WELLNESS,
    form_version_id: `${WELLNESS.slice(0, -2)}f1`,
    form_version: 1,
    athlete_id: athleteId,
    athlete_display_name: athleteId === MAYA ? "Maya Okafor" : "Leo Lindqvist",
    submitted_by: null,
    observed_at: `${day}T11:00:00Z`,
    local_date: day,
    values: { sleep_quality: 3 },
    computed: { double: 6 },
    source: "mobile",
    import_batch_id: null,
    created_at: `${day}T11:00:00Z`,
    updated_at: `${day}T11:00:00Z`,
  };
}

const metric = {
  id: "00000000-0000-4000-8000-0000000000d1",
  org_id: ORG,
  slug: "wellness",
  name: "Wellness",
  description: null,
  unit: "AU",
  source: "form:wellness.double",
  daily_agg: "last" as const,
  fill_zero: false,
  transform: "none" as const,
  params: {},
  thresholds: { direction: "high_bad" as const, amber: 10, red: 12 },
  decimals: 0,
  athlete_visible: true,
  builtin: true,
};

/** A two-athlete org; `admin` false gives a coach-like login (general forms, write on Sprints). */
function fixture(opts: { admin?: boolean; masked?: boolean } = {}): DemoFixture {
  const admin = opts.admin ?? true;
  const masked = opts.masked ?? false;
  const org = {
    id: ORG,
    name: "Demo Performance",
    slug: "demo-performance",
    timezone: "America/New_York",
    settings: { terminology: { athlete: "Athlete", athletes: "Athletes", group: "Group", groups: "Groups" }, readiness_metrics: ["wellness"], wearable_priority: [] },
    created_at: "2026-09-01T10:00:00Z",
  };
  const user = { id: "00000000-0000-4000-8000-0000000000e1", email: "admin@example.com", full_name: "Avery Admin", is_active: true, created_at: "2026-09-01T10:00:00Z" };
  const rights = { identifiable: !masked, write: true, read: ["general" as const], write_forms: ["general" as const] };
  const board = (date: string) => ({
    date,
    group_id: null,
    columns: [metric],
    rows: [
      {
        athlete: { id: MAYA, display_name: "Maya Okafor", code: "A-0001", position: "100m" },
        cells: { wellness: { value: 13, flag: "red" as const, date, missing: null } },
        due_forms: 1,
        scheduled_forms: 1,
      },
    ],
  });
  return {
    format: 1,
    role: "owner",
    email: "admin@example.com",
    generated_on: DAY,
    data_start: "2026-10-10",
    org_id: ORG,
    audit: { items: [], total: 0 },
    me: { user, memberships: [{ org, role: admin ? "owner" : "staff", athlete_id: null }] },
    org,
    members: [{ user, role: "owner", athlete_id: null, assignments: [] }],
    invitations: admin ? [] : { $error: { status: 403, body: { detail: "admin role required" } } },
    groups: [
      { id: TEAM, org_id: ORG, parent_id: null, name: "Athletics", kind: "team", description: null, archived: false, athlete_count: 0, created_at: "2026-09-01T10:00:00Z" },
      { id: SPRINTS, org_id: ORG, parent_id: TEAM, name: "Sprints", kind: "squad", description: null, archived: false, athlete_count: 2, created_at: "2026-09-01T10:00:00Z" },
    ],
    staff: { [TEAM]: [], [SPRINTS]: [] },
    athletes: [athlete(MAYA, "A-0001", "Maya", "Okafor", masked), athlete(LEO, "A-0002", "Leo", "Lindqvist", masked)],
    access: {
      role: admin ? "owner" : "staff",
      is_admin: admin,
      is_owner: admin,
      athlete_id: null,
      readable_sensitivities: admin ? ["general", "medical", "research"] : ["general"],
      writable_sensitivities: admin ? ["general", "medical", "research"] : ["general"],
      writable_group_ids: admin ? null : [TEAM, SPRINTS],
      identifiable_group_ids: admin ? null : masked ? [] : [TEAM, SPRINTS],
      athletes: admin ? {} : { [MAYA]: rights, [LEO]: rights },
    },
    forms: admin ? [form(WELLNESS, "wellness", "Wellness", "general"), form(INJURY, "injury", "Injury", "medical")] : [form(WELLNESS, "wellness", "Wellness", "general")],
    form_versions: { [WELLNESS]: [form(WELLNESS, "wellness", "Wellness", "general").current_version] },
    schedules: { [WELLNESS]: [] },
    form_templates: [],
    template_settings: {},
    submissions: [submission(1, MAYA, "2026-10-11"), submission(2, LEO, "2026-10-11"), submission(3, MAYA, DAY)],
    imports: [],
    metrics: [metric],
    series_sources: [{ ref: "form:wellness.double", label: "Wellness: Double", unit: null, kind: "form" }],
    series: {
      start: "2026-10-10",
      end: DAY,
      points: {
        wellness: {
          [MAYA]: [
            ["2026-10-10", 9, "green", null],
            ["2026-10-11", 11, "amber", null],
            [DAY, 13, "red", null],
          ],
          [LEO]: { $error: { status: 403, body: { detail: "the metric's source form is not readable for you" } } },
        },
      },
    },
    readiness: { all: { "2026-10-11": board("2026-10-11"), [DAY]: board(DAY) } },
    wearables: {
      providers: { $error: { status: 503, body: { detail: "Open Wearables is not configured (OW_BASE_URL / OW_API_KEY)" } } },
      status: {
        [MAYA]: {
          linked: false,
          ow_user_id: null,
          connections: [],
          priority: null,
          effective_priority: ["apple", "garmin"],
          sources: ["garmin", "oura"],
          history_synced_at: null,
        },
      },
      daily: { [MAYA]: [{ local_date: DAY, metric: "steps", value: 9000, unit: "steps", provider: "oura", device: null }] },
    },
  };
}

/** A backend whose fixtures are already "today" (no date shift). */
function backend(f: DemoFixture = fixture()) {
  const b = new DemoBackend({ load: async () => f });
  let token = "";
  const call = async (method: string, path: string, body?: unknown, extra: { formData?: FormData; query?: string } = {}): Promise<DemoResponse> =>
    b.handle({
      method,
      path,
      query: new URLSearchParams(extra.query ?? ""),
      body,
      formData: extra.formData ?? null,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  return {
    call,
    async login(email = "admin@example.com") {
      const r = await call("POST", "/auth/login", { email, password: DEMO_PASSWORD });
      token = (r.body as { access_token: string }).access_token;
      return r;
    },
  };
}

const o = (path: string) => `/orgs/${ORG}${path}`;
const detail = (r: DemoResponse) => (r.body as { detail: unknown }).detail;

describe("auth", () => {
  it("accepts only the demo accounts and their password", async () => {
    const api = backend();
    expect((await api.call("POST", "/auth/login", { email: "admin@example.com", password: "nope" })).status).toBe(401);
    expect((await api.call("POST", "/auth/login", { email: "someone@else.org", password: DEMO_PASSWORD })).status).toBe(401);
    expect((await api.call("GET", "/me")).status).toBe(401);
    const r = await api.login();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ token_type: "bearer", user: { email: "admin@example.com" } });
    expect((r.body as { access_token: string }).access_token).toMatch(/^demo\.owner\./);
    expect((await api.call("GET", "/me")).status).toBe(200);
  });

  it("rotates a demo refresh token and keeps the role", async () => {
    const api = backend();
    const r = await api.call("POST", "/auth/refresh", { refresh_token: "demo-refresh.coach.abc" });
    expect((r.body as { access_token: string }).access_token).toMatch(/^demo\.coach\./);
    expect((await api.call("POST", "/auth/refresh", { refresh_token: "garbage" })).status).toBe(401);
  });

  it("answers 501 for endpoints the demo does not implement and 404 for another org", async () => {
    const api = backend();
    await api.login();
    const r = await api.call("POST", o("/me/wearables/sdk-token"));
    expect(r.status).toBe(501);
    expect(detail(r)).toBe("Not available in the demo");
    expect((await api.call("GET", "/orgs/other/athletes")).status).toBe(404);
  });
});

describe("reads", () => {
  it("filters, searches and pages athletes like the API", async () => {
    const api = backend();
    await api.login();
    const all = await api.call("GET", o("/athletes"), undefined, { query: `group_id=${TEAM}&limit=1` });
    expect(all.body).toMatchObject({ total: 2, items: [{ code: "A-0001" }] });
    const q = await api.call("GET", o("/athletes"), undefined, { query: "q=lindq" });
    expect((q.body as { items: Athlete[] }).items.map((a) => a.code)).toEqual(["A-0002"]);
    expect((await api.call("GET", o("/athletes"), undefined, { query: "limit=501" })).status).toBe(422);
  });

  it("never matches names of masked athletes", async () => {
    const api = backend(fixture({ admin: false, masked: true }));
    await api.login();
    const q = await api.call("GET", o("/athletes"), undefined, { query: "q=maya" });
    expect(q.body).toMatchObject({ total: 0 });
    const code = await api.call("GET", o("/athletes"), undefined, { query: "q=a-0001" });
    expect(code.body).toMatchObject({ total: 1 });
  });

  it("lists submissions newest first with date filters", async () => {
    const api = backend();
    await api.login();
    const r = await api.call("GET", o("/submissions"), undefined, { query: `start=2026-10-11&end=2026-10-11&athlete_id=${MAYA}` });
    expect(r.body).toMatchObject({ total: 1 });
    const all = (await api.call("GET", o("/submissions"))).body as { items: Submission[] };
    expect(all.items.map((s) => s.local_date)).toEqual([DAY, "2026-10-11", "2026-10-11"]);
  });

  it("serves metric series over any range, padding days outside the export with nulls", async () => {
    const api = backend();
    await api.login();
    const r = await api.call("GET", o("/metrics/wellness/series"), undefined, { query: `athlete_id=${MAYA}&start=2026-10-09&end=${DAY}` });
    const points = (r.body as { points: { date: string; value: number | null; flag: string | null }[] }).points;
    expect(points.map((p) => [p.date, p.value, p.flag])).toEqual([
      ["2026-10-09", null, null],
      ["2026-10-10", 9, "green"],
      ["2026-10-11", 11, "amber"],
      [DAY, 13, "red"],
    ]);
    // the API refused this one at export time: the demo refuses it too
    const refused = await api.call("GET", o("/metrics/wellness/series"), undefined, { query: `athlete_id=${LEO}` });
    expect(refused.status).toBe(403);
  });

  it("serves exported readiness boards and derives older days from the series", async () => {
    const api = backend();
    await api.login();
    const today = (await api.call("GET", o("/dashboards/readiness"), undefined, { query: `date=${DAY}` })).body as {
      rows: {
        athlete: { code: string };
        cells: Record<string, { value: number | null; missing?: { reason: string } | null }>;
        due_forms: number;
        scheduled_forms: number;
      }[];
    };
    expect(today.rows.map((r) => [r.athlete.code, r.cells.wellness!.value, r.due_forms])).toEqual([
      ["A-0001", 13, 1],
      ["A-0002", null, 0],
    ]);
    const older = (await api.call("GET", o("/dashboards/readiness"), undefined, { query: "date=2026-10-10" })).body as typeof today;
    expect(older.rows[0]!.cells.wellness).toEqual({ value: 9, flag: "green", date: "2026-10-10", missing: null });
    // athletes without an exported row: the demo can only say there is no value
    const leo = today.rows[1]!;
    expect(leo.cells.wellness!.missing?.reason).toBe("no_data");
    expect([today.rows[0]!.scheduled_forms, leo.scheduled_forms]).toEqual([1, 0]);
    // a group this login cannot list (a filter remembered from another role) filters by membership
    const sprints = (await api.call("GET", o("/dashboards/readiness"), undefined, { query: `group_id=${TEAM}` })).body as typeof today;
    expect(sprints.rows).toHaveLength(2);
    const unknown = (await api.call("GET", o("/dashboards/readiness"), undefined, { query: "group_id=nope" })).body as typeof today;
    expect(unknown.rows).toEqual([]);
  });

  it("replays the honest Open Wearables state", async () => {
    const api = backend();
    await api.login();
    const providers = await api.call("GET", o("/wearables/providers"));
    expect(providers.status).toBe(503);
    const status = (await api.call("GET", o(`/athletes/${MAYA}/wearables`))).body as { linked: boolean; sources: string[] };
    expect(status.linked).toBe(false);
    // the ranking is recomputed from this tab's settings; sources follow it
    const ranked = await api.call("PUT", o(`/athletes/${MAYA}/wearables/priority`), { providers: ["oura"] });
    expect(ranked.status).toBe(200);
    expect(ranked.body).toMatchObject({ priority: ["oura"], sources: ["oura", "garmin"] });
    expect((ranked.body as { effective_priority: string[] }).effective_priority.slice(0, 2)).toEqual(["oura", "apple"]);
    expect((await api.call("PUT", o(`/athletes/${MAYA}/wearables/priority`), { providers: ["Oura!"] })).status).toBe(422);
    const reset = await api.call("PUT", o(`/athletes/${MAYA}/wearables/priority`), { providers: null });
    expect(reset.body).toMatchObject({ priority: null, sources: ["garmin", "oura"] });
    expect((await api.call("POST", o(`/athletes/${MAYA}/wearables/history`))).status).toBe(409);
    expect((await api.call("GET", o(`/athletes/${MAYA}/wearables/daily`), undefined, { query: `start=${DAY}&end=${DAY}` })).body).toHaveLength(1);
    expect((await api.call("POST", o(`/athletes/${MAYA}/wearables/link`))).status).toBe(503);
  });
});

describe("submissions", () => {
  it("validates with the shared form engine: 422 field errors, 201 with computed values, 409 per day", async () => {
    const api = backend();
    await api.login();
    const bad = await api.call("POST", o("/submissions"), { form_id: WELLNESS, athlete_id: LEO, values: { sleep_quality: 9, extra: 1 } });
    expect(bad.status).toBe(422);
    expect(detail(bad)).toEqual({ message: "invalid submission", field_errors: { sleep_quality: "out_of_range", extra: "unknown_field" } });

    const ok = await api.call("POST", o("/submissions"), { form_id: WELLNESS, athlete_id: LEO, values: { sleep_quality: 4 }, local_date: DAY });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ computed: { double: 8 }, local_date: DAY, source: "web", athlete_display_name: "Leo Lindqvist" });

    const dup = await api.call("POST", o("/submissions"), { form_id: WELLNESS, athlete_id: LEO, values: { sleep_quality: 4 }, local_date: DAY });
    expect(dup.status).toBe(409);
  });

  it("saves bulk entries one by one and reports the rest", async () => {
    const api = backend();
    await api.login();
    const r = await api.call("POST", o("/submissions/bulk"), {
      form_id: WELLNESS,
      local_date: "2026-10-10",
      entries: [
        { athlete_id: MAYA, values: { sleep_quality: 2 } },
        { athlete_id: MAYA, values: { sleep_quality: 3 } },
        { athlete_id: LEO, values: {} },
        { athlete_id: "missing", values: { sleep_quality: 3 } },
      ],
    });
    expect((r.body as { created: Submission[] }).created).toHaveLength(1);
    expect((r.body as { errors: unknown[] }).errors).toEqual([
      { athlete_id: MAYA, field_errors: { local_date: "duplicate" } },
      { athlete_id: LEO, field_errors: { sleep_quality: "required" } },
      { athlete_id: "missing", field_errors: { athlete_id: "not_found" } },
    ]);
  });

  it("edits against the submission's own version and deletes", async () => {
    const api = backend();
    await api.login();
    const id = submission(1, MAYA, "2026-10-11").id;
    const r = await api.call("PATCH", o(`/submissions/${id}`), { values: { sleep_quality: 6 } });
    expect(r.body).toMatchObject({ values: { sleep_quality: 6 }, computed: { double: 12 } });
    expect((await api.call("PATCH", o(`/submissions/${id}`), { local_date: DAY })).status).toBe(409);
    expect((await api.call("DELETE", o(`/submissions/${id}`))).status).toBe(204);
    expect((await api.call("GET", o(`/submissions/${id}`))).status).toBe(404);
  });

  it("refuses writes the login may not make", async () => {
    const api = backend(fixture({ admin: false }));
    await api.login();
    expect((await api.call("POST", o("/forms"), { name: "X", kind: "test" })).status).toBe(403);
    expect((await api.call("GET", o("/invitations"))).status).toBe(403);
    expect((await api.call("POST", o("/submissions"), { form_id: INJURY, athlete_id: MAYA, values: {} })).status).toBe(404);
  });

  it("exports CSV with names, de-identified, or by code for masked athletes", async () => {
    const api = backend();
    await api.login();
    const named = await api.call("GET", o("/submissions/export"), undefined, { query: `form_id=${WELLNESS}` });
    expect(named.contentType).toMatch(/^text\/csv/);
    const lines = named.text!.trim().split("\n");
    expect(lines[0]).toBe("submission_id,athlete_code,athlete_name,local_date,observed_at,source,form_version,sleep_quality,sleep_hours,double");
    expect(lines[1]).toContain(",A-0001,Maya Okafor,2026-10-11,");
    expect(lines).toHaveLength(4);
    const anon = await api.call("GET", o("/submissions/export"), undefined, { query: `form_id=${WELLNESS}&deidentified=true` });
    expect(anon.text!.split("\n")[0]).not.toContain("athlete_name");

    const blinded = backend(fixture({ admin: false, masked: true }));
    await blinded.login();
    const masked = await blinded.call("GET", o("/submissions/export"), undefined, { query: `form_id=${WELLNESS}` });
    expect(masked.text).not.toContain("athlete_name");
    expect(masked.text).not.toContain("Maya");
  });
});

describe("forms", () => {
  it("publishes like the API: schema errors, a new version, no-op when unchanged", async () => {
    expect(validateSchema(schema)).toEqual([]);
    const api = backend();
    await api.login();
    const created = await api.call("POST", o("/forms"), { name: "Grip test", kind: "test" });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string; slug: string }).id;
    expect((created.body as { slug: string }).slug).toBe("grip_test");
    const broken = { schema_version: 1, sections: [{ key: "s", title: "S", fields: [{ key: "x", type: "calculated", label: "X", expression: "nope +" }] }] };
    await api.call("PATCH", o(`/forms/${id}`), { draft_schema: broken });
    const refused = await api.call("POST", o(`/forms/${id}/publish`));
    expect(refused.status).toBe(422);
    expect((detail(refused) as { schema_errors: unknown[] }).schema_errors.length).toBeGreaterThan(0);
    await api.call("PATCH", o(`/forms/${id}`), { draft_schema: schema });
    const v1 = await api.call("POST", o(`/forms/${id}/publish`));
    expect(v1.body).toMatchObject({ version: 1 });
    const again = await api.call("POST", o(`/forms/${id}/publish`));
    expect((again.body as { id: string }).id).toBe((v1.body as { id: string }).id);
    expect((await api.call("GET", o("/series-sources"))).body).toContainEqual(expect.objectContaining({ ref: "form:grip_test.sleep_quality" }));
  });
});

describe("imports", () => {
  const upload = (name: string, text: string) => {
    const fd = new FormData();
    fd.append("file", new File([text], name, { type: "text/csv" }));
    return fd;
  };

  it("refuses XLSX with a clear message", async () => {
    const api = backend();
    await api.login();
    const r = await api.call("POST", o(`/forms/${WELLNESS}/imports/preview`), undefined, { formData: upload("sheet.xlsx", "PK") });
    expect(r.status).toBe(400);
    expect(detail(r)).toMatch(/^XLSX import is not available in the demo/);
  });

  it("previews, dry-runs, imports and rolls back a CSV", async () => {
    const api = backend();
    await api.login();
    const csv = "Athlete,Date,Sleep quality,Hours slept\nA-0002,2026-10-10,5,7.5\nA-0001,2026-10-11,4,\nA-9999,2026-10-10,4,8\nA-0002,2026-10-09,11,8\n";
    const p = await api.call("POST", o(`/forms/${WELLNESS}/imports/preview`), undefined, { formData: upload("export.csv", csv) });
    expect(p.body).toMatchObject({
      columns: ["Athlete", "Date", "Sleep quality", "Hours slept"],
      row_count: 4,
      suggested_athlete_column: "Athlete",
      suggested_date_column: "Date",
      suggested_mapping: { "Sleep quality": "sleep_quality", "Hours slept": "sleep_hours" },
    });
    const body = {
      upload_id: (p.body as { upload_id: string }).upload_id,
      mapping: { "Sleep quality": "sleep_quality", "Hours slept": "sleep_hours" },
      athlete_column: "Athlete",
      athlete_match: "code",
      date_column: "Date",
      dry_run: true,
    };
    const before = ((await api.call("GET", o("/submissions"))).body as { total: number }).total;
    const dry = await api.call("POST", o(`/forms/${WELLNESS}/imports`), body);
    expect(dry.status).toBe(201);
    expect(dry.body).toMatchObject({
      dry_run: true,
      row_count: 4,
      created_count: 1,
      skipped_count: 3,
      errors: [
        { row: 2, message: "athlete A-0001 already has a submission on 2026-10-11" },
        { row: 3, message: "Athlete: no athlete matches 'A-9999'" },
        { row: 4, message: "invalid values (sleep_quality: out_of_range)" },
      ],
    });
    expect(((await api.call("GET", o("/submissions"))).body as { total: number }).total).toBe(before);

    const real = await api.call("POST", o(`/forms/${WELLNESS}/imports`), { ...body, dry_run: false });
    const batch = real.body as { id: string };
    const imported = (await api.call("GET", o("/submissions"), undefined, { query: "source=import" })).body as { items: Submission[] };
    expect(imported.items).toHaveLength(1);
    expect(imported.items[0]).toMatchObject({ import_batch_id: batch.id, local_date: "2026-10-10", values: { sleep_quality: 5, sleep_hours: 7.5 } });
    expect(((await api.call("GET", o("/imports"))).body as unknown[]).length).toBe(2);
    expect((await api.call("DELETE", o(`/imports/${batch.id}`))).status).toBe(204);
    expect(((await api.call("GET", o("/submissions"))).body as { total: number }).total).toBe(before);
  });
});

describe("prepareFixture", () => {
  it("shifts every date so the export ends today in the org's time zone", () => {
    const now = new Date("2026-10-20T14:00:00Z"); // 10:00 in New York
    const f = prepareFixture(fixture(), now);
    expect(f.generated_on).toBe("2026-10-20");
    expect((f.submissions as Submission[])[2]!.observed_at).toBe("2026-10-20T11:00:00Z");
    expect(Object.keys((f.readiness as Record<string, object>).all!)).toEqual(["2026-10-19", "2026-10-20"]);
    expect(f.athletes).toEqual((fixture().athletes as Athlete[]).map((a) => ({ ...a, created_at: "2026-09-09T10:00:00Z" })));
  });

  it("rejects an unknown format", () => {
    expect(() => prepareFixture({ ...fixture(), format: 99 })).toThrow(/format 99/);
  });
});

// keep the role list in sync with the exporter's DEMO_ROLES
const ROLES: DemoRole[] = ["owner", "coach", "medic", "researcher", "athlete"];
it("has an account per exported role", async () => {
  const { DEMO_ACCOUNTS } = await import("./accounts");
  expect(DEMO_ACCOUNTS.map((a) => a.role)).toEqual(ROLES);
});
