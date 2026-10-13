/**
 * Metrics, series, the readiness board, wearables, audit and the athlete's own views.
 * Series and boards are the values the API computed when the demo was built; the demo never
 * recomputes metrics (new submissions do not move them).
 */
import {
  WEARABLE_METRICS,
  addDays,
  dateRange,
  isISODate,
  type MetricDefinition,
  type MetricPoint,
  type ReadinessCell,
  type ReadinessRow,
  type WearableMetric,
  type WearableStatus,
} from "@ams/shared";
import { isFixtureError } from "../fixture";
import { HttpError, fail, has, json, noContent, paginate, replay, requiredString } from "../http";
import { route, type Ctx, type RouteDef } from "../router";
import { newId, type DemoStore } from "../store";
import { listResponse } from "./submissions";

const ORG = "/orgs/:org";
const READINESS_WINDOW_DAYS = 3;
const MAX_SERIES_DAYS = 3 * 366;

function dateParam(ctx: Ctx, key: string): string | null {
  const v = ctx.req.query.get(key);
  if (v === null || v === "") return null;
  if (!isISODate(v)) {
    throw new HttpError(422, { detail: [{ loc: ["query", key], msg: "Input should be a valid date", type: "date_from_datetime_parsing" }] });
  }
  return v;
}

function range(ctx: Ctx): [string, string] {
  const end = dateParam(ctx, "end") ?? ctx.store.today();
  const start = dateParam(ctx, "start") ?? addDays(end, -27);
  if (start > end) throw fail(400, "start must not be after end");
  if (dateRange(start, end).length - 1 > MAX_SERIES_DAYS) throw fail(400, "date range too long (max 3 years)");
  return [start, end];
}

/** Latest value on or before `date` within the readiness window, from the precomputed series. */
function derivedCell(store: DemoStore, slug: string, athleteId: string, date: string): ReadinessCell {
  for (let back = 0; back <= READINESS_WINDOW_DAYS; back++) {
    const d = addDays(date, -back);
    const p = store.point(slug, athleteId, d);
    if (p && p[1] !== null) return { value: p[1], flag: p[2], date: p[0] };
  }
  return { value: null, flag: null, date: null };
}

function readiness(ctx: Ctx) {
  const { store, req } = ctx;
  replay(store.fixture.readiness);
  const groupId = req.query.get("group_id") || null;
  const date = dateParam(ctx, "date") ?? store.today();
  const dates = store.boardDates();
  const last = dates[dates.length - 1];
  // the exported board for that day; after the last one, the last one; before the first, none
  const source = dates.includes(date) ? date : last !== undefined && date > last ? last : null;
  const columns = store.org.settings.readiness_metrics
    .map((slug) => store.metricList().find((m) => m.slug === slug))
    .filter((m): m is MetricDefinition => m !== undefined);
  const inGroup = groupId ? store.athleteIdsInGroup(groupId) : null;
  const athletes = store
    .athleteList()
    .filter((a) => a.status === "active" && (!inGroup || inGroup.has(a.id)))
    .sort((a, b) => a.code.localeCompare(b.code));
  const rows: ReadinessRow[] = athletes.map((a) => {
    const exported = source ? (store.boardRow(groupId ?? "all", source, a.id) ?? store.boardRow("all", source, a.id)) : undefined;
    const cells: Record<string, ReadinessCell> = {};
    for (const m of columns) {
      const fromBoard = store.changedMetrics.has(m.slug) ? undefined : exported?.cells[m.slug];
      cells[m.slug] = fromBoard ?? derivedCell(store, m.slug, a.id, date);
    }
    return {
      athlete: { id: a.id, display_name: a.display_name, code: a.code, position: a.position },
      cells,
      due_forms: exported?.due_forms ?? 0,
    };
  });
  return json({ date, group_id: groupId, columns, rows });
}

function series(ctx: Ctx) {
  const { store, params, req } = ctx;
  const athleteId = req.query.get("athlete_id");
  if (!athleteId) throw new HttpError(422, { detail: [{ loc: ["query", "athlete_id"], msg: "Field required", type: "missing" }] });
  const athlete = store.athlete(athleteId);
  const metric = store.metric(params.slug!);
  if (store.isAthlete && !metric.athlete_visible) throw fail(404, "metric not found");
  const recorded = store.seriesError(metric.slug, athlete.id);
  if (recorded && !store.changedMetrics.has(metric.slug)) replay(recorded);
  const [start, end] = range(ctx);
  const points: MetricPoint[] = dateRange(start, end).map((date) => {
    const p = store.point(metric.slug, athlete.id, date);
    return p ? { date, value: p[1], flag: p[2], source: p[3] } : { date, value: null, flag: null, source: null };
  });
  return json({ metric, athlete_id: athlete.id, points });
}

function sourceKnown(store: DemoStore, source: string): boolean {
  return replay(store.seriesSources).some((s) => s.ref === source);
}

function saveMetric(store: DemoStore, body: Record<string, unknown>, existing: MetricDefinition | null): MetricDefinition {
  const target: Record<string, unknown> = existing ? { ...existing } : { id: newId(), org_id: store.orgId, builtin: false };
  for (const key of ["slug", "name", "source", "daily_agg", "fill_zero", "transform", "params", "decimals", "athlete_visible"]) {
    if (has(body, key) && body[key] === null) throw fail(400, `${key} cannot be null`);
  }
  for (const key of ["slug", "name", "description", "unit", "source", "daily_agg", "fill_zero", "transform", "params", "thresholds", "decimals", "athlete_visible"]) {
    if (has(body, key)) target[key] = body[key];
  }
  const m = target as MetricDefinition;
  if (existing && m.slug !== existing.slug) {
    if (existing.builtin) throw fail(400, "built-in metric slugs cannot change");
    if (store.metricList().some((x) => x.slug === m.slug)) throw fail(409, `metric slug '${m.slug}' already exists`);
  }
  if ((!existing || m.source !== existing.source) && !sourceKnown(store, m.source)) {
    throw fail(422, `unknown source '${m.source}'`);
  }
  if (m.source === `metric:${m.slug}`) throw fail(422, "circular metric reference");
  m.description ??= null;
  m.unit ??= null;
  m.thresholds ??= null;
  m.params ??= {};
  m.fill_zero ??= false;
  m.decimals ??= 2;
  m.athlete_visible ??= false;
  return m;
}

const SERIES_FIELDS = ["source", "daily_agg", "fill_zero", "transform", "params"] as const;

export const insightRoutes: RouteDef[] = [
  // ---------------------------------------------------------------- metric definitions
  route("GET", `${ORG}/metrics`, ({ store }) => {
    store.requireStaff();
    return json([...replay(store.metrics)].sort((a, b) => a.name.localeCompare(b.name)));
  }),
  route("POST", `${ORG}/metrics`, ({ store, body: getBody }) => {
    store.requireAdmin();
    const body = getBody();
    const slug = requiredString(body, "slug");
    requiredString(body, "name");
    requiredString(body, "source");
    if (store.metricList().some((m) => m.slug === slug)) throw fail(409, `metric slug '${slug}' already exists`);
    const m = saveMetric(store, body, null);
    replay(store.metrics).push(m);
    store.changedMetrics.add(m.slug);
    const sources = store.seriesSources;
    if (!isFixtureError(sources)) sources.push({ ref: `metric:${m.slug}`, label: m.name, unit: m.unit, kind: "metric" });
    return json(m, 201);
  }),
  route("PATCH", `${ORG}/metrics/:id`, ({ store, params, body: getBody }) => {
    store.requireAdmin();
    const list = replay(store.metrics);
    const i = list.findIndex((m) => m.id === params.id);
    if (i < 0) throw fail(404, "metric not found");
    const before = list[i]!;
    const m = saveMetric(store, getBody(), before);
    list[i] = m;
    if (SERIES_FIELDS.some((k) => JSON.stringify(m[k]) !== JSON.stringify(before[k]))) store.changedMetrics.add(m.slug);
    if (m.slug !== before.slug) {
      store.changedMetrics.add(m.slug);
      store.org.settings.readiness_metrics = store.org.settings.readiness_metrics.map((s) => (s === before.slug ? m.slug : s));
    }
    const sources = store.seriesSources;
    if (!isFixtureError(sources)) {
      const s = sources.find((x) => x.ref === `metric:${before.slug}`);
      if (s) Object.assign(s, { ref: `metric:${m.slug}`, label: m.name, unit: m.unit });
    }
    return json(m);
  }),
  route("DELETE", `${ORG}/metrics/:id`, ({ store, params }) => {
    store.requireAdmin();
    const list = replay(store.metrics);
    const m = list.find((x) => x.id === params.id);
    if (!m) throw fail(404, "metric not found");
    if (m.builtin) throw fail(400, "built-in metrics can be edited, not deleted");
    const dependents = list.filter((x) => x.source === `metric:${m.slug}`).map((x) => x.slug);
    if (dependents.length) throw fail(409, `metric is used by: ${dependents.join(", ")}`);
    list.splice(list.indexOf(m), 1);
    const sources = store.seriesSources;
    if (!isFixtureError(sources)) store.seriesSources = sources.filter((s) => s.ref !== `metric:${m.slug}`);
    return noContent();
  }),
  route("GET", `${ORG}/series-sources`, ({ store }) => {
    store.requireStaff();
    return json(replay(store.seriesSources));
  }),
  route("GET", `${ORG}/metrics/:slug/series`, series),
  route("GET", `${ORG}/dashboards/readiness`, readiness),

  // ---------------------------------------------------------------- wearables (Open Wearables is not configured in the demo)
  route("GET", `${ORG}/wearables/providers`, ({ store }) => {
    store.requireStaff();
    return json(replay(store.fixture.wearables.providers));
  }),
  route("GET", `${ORG}/athletes/:id/wearables`, ({ store, params }) => {
    const a = store.athlete(params.id!);
    const recorded = store.fixture.wearables.status[a.id];
    const fallback: WearableStatus = { linked: a.ow_user_id !== null, ow_user_id: a.ow_user_id, connections: [] };
    return json(recorded === undefined ? fallback : replay(recorded));
  }),
  ...(["link", "connect"] as const).map((action) =>
    route("POST", `${ORG}/athletes/:id/wearables/${action}`, ({ store, params }) => {
      const a = store.athlete(params.id!);
      if (!store.rights(a.id)?.write) throw fail(403, "write access to the athlete required");
      throw owNotConfigured(store);
    }),
  ),
  route("POST", `${ORG}/athletes/:id/wearables/refresh`, ({ store, params }) => {
    const a = store.athlete(params.id!);
    if (!store.rights(a.id)?.write) throw fail(403, "write access to the athlete required");
    if (a.ow_user_id === null) throw fail(409, "athlete is not linked to Open Wearables");
    throw owNotConfigured(store);
  }),
  route("GET", `${ORG}/athletes/:id/wearables/daily`, (ctx) => {
    const a = ctx.store.athlete(ctx.params.id!);
    const [start, end] = range(ctx);
    const names = (ctx.req.query.get("metrics") ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const unknown = names.filter((n) => !WEARABLE_METRICS.includes(n as WearableMetric));
    if (unknown.length) throw fail(400, `unknown wearable metric(s): ${unknown.join(", ")}`);
    const recorded = ctx.store.fixture.wearables.daily[a.id];
    const points = recorded === undefined ? [] : replay(recorded);
    return json(points.filter((p) => p.local_date >= start && p.local_date <= end && (names.length === 0 || names.includes(p.metric))));
  }),

  // ---------------------------------------------------------------- audit
  route("GET", `${ORG}/audit`, ({ store, req }) => {
    store.requireAdmin();
    const page = replay(store.fixture.audit);
    const type = req.query.get("entity_type");
    const id = req.query.get("entity_id");
    return json(paginate(page.items.filter((e) => (!type || e.entity_type === type) && (!id || e.entity_id === id)), req.query));
  }),

  // ---------------------------------------------------------------- athlete self-service (read-only in the demo)
  route("GET", `${ORG}/me/athlete`, ({ store }) => json(replay(self(store).athlete))),
  route("GET", `${ORG}/me/forms`, ({ store }) => json(replay(self(store).forms))),
  route("GET", `${ORG}/me/submissions`, ({ store, req }) => {
    const list = replay(self(store).submissions);
    const formId = req.query.get("form_id");
    const start = req.query.get("start");
    const end = req.query.get("end");
    const items = list.filter((s) => (!formId || s.form_id === formId) && (!start || s.local_date >= start) && (!end || s.local_date <= end));
    return listResponse(store, items, req.query);
  }),
  route("GET", `${ORG}/me/wearables`, ({ store }) => json(replay(self(store).wearables))),
  route("GET", `${ORG}/me/wearables/providers`, ({ store }) => {
    self(store);
    return json(replay(store.fixture.wearables.providers));
  }),
];

function self(store: DemoStore) {
  const s = store.fixture.self;
  if (!s) throw fail(403, "caller is not an athlete in this organization");
  return s;
}

function owNotConfigured(store: DemoStore): HttpError {
  const p = store.fixture.wearables.providers;
  if (isFixtureError(p)) return new HttpError(p.$error.status, p.$error.body);
  return fail(503, "Open Wearables is not configured (OW_BASE_URL / OW_API_KEY)");
}
