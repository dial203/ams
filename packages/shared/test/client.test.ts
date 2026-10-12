import { describe, expect, it, vi } from "vitest";
import { ApiError, buildQuery, createApiClient, isApiError } from "../src/api";
import type { ApiClient, ApiClientOptions } from "../src/api";
import type { FormSchema } from "../src/forms";

const BASE = "https://ams.test/api/v1";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | null | undefined;
}

function json(status: number, body: unknown, init: ResponseInit = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

/**
 * A fetch mock: `handler` decides the response per call; every call is recorded with
 * the Authorization header it carried.
 */
function setup(
  handler: (call: Call, n: number) => Response | Promise<Response> = () => json(200, {}),
  options: Partial<ApiClientOptions> = {},
) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body,
      signal: init?.signal,
    };
    calls.push(call);
    return handler(call, calls.length);
  });
  const state = { token: "t1" as string | null };
  const client = createApiClient({
    baseUrl: `${BASE}/`,
    fetch: fetchMock as unknown as typeof fetch,
    getAccessToken: () => state.token,
    ...options,
  });
  return { client, calls, fetchMock, state };
}

describe("requests", () => {
  it("sends the bearer token, JSON body and headers", async () => {
    const { client, calls } = setup(() => json(201, { id: "s1" }), { headers: { "X-App": "web/1.0" } });
    const res = await client.submissions.create("org-1", { form_id: "f", athlete_id: "a", values: { rpe: 7 } });
    expect(res).toEqual({ id: "s1" });
    expect(calls[0]).toMatchObject({
      url: `${BASE}/orgs/org-1/submissions`,
      method: "POST",
      headers: {
        Authorization: "Bearer t1",
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-App": "web/1.0",
      },
      body: JSON.stringify({ form_id: "f", athlete_id: "a", values: { rpe: 7 } }),
    });
  });

  it("supports an async token getter and omits the header without a token", async () => {
    const { client, calls } = setup(() => json(200, {}), { getAccessToken: async () => null });
    await client.auth.getInvite("abc/def");
    await client.health();
    expect(calls.map((c) => c.headers.Authorization)).toEqual([undefined, undefined]);
    expect(calls[0]!.url).toBe(`${BASE}/auth/invite/abc%2Fdef`);
    expect(calls[1]!.url).toBe(`${BASE}/health`);
  });

  it("encodes path segments and serialises query parameters", async () => {
    const { client, calls } = setup(() => json(200, []));
    await client.athletes.list("org 1", { q: "Lee & co", group_id: null, status: undefined, limit: 50, offset: 0 });
    await client.wearables.daily("o", "a", { start: "2026-10-01", end: "2026-10-12", metrics: ["hrv_rmssd_ms", "steps"] });
    await client.groups.list("o", { include_archived: true });
    await client.wearables.daily("o", "a", { metrics: [] });
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/orgs/org%201/athletes?q=Lee%20%26%20co&limit=50&offset=0`,
      `${BASE}/orgs/o/athletes/a/wearables/daily?start=2026-10-01&end=2026-10-12&metrics=hrv_rmssd_ms,steps`,
      `${BASE}/orgs/o/groups?include_archived=true`,
      `${BASE}/orgs/o/athletes/a/wearables/daily`,
    ]);
    expect(buildQuery({ a: [1, null, "x,y"], b: false, c: undefined })).toBe("a=1,x%2Cy&b=false");
  });

  it("returns undefined for 204 and empty bodies, text for CSV", async () => {
    const { client, calls } = setup((c) =>
      c.url.includes("export")
        ? new Response("submission_id,athlete_code\n1,P-1\n", { status: 200, headers: { "Content-Type": "text/csv" } })
        : new Response(null, { status: 204 }),
    );
    await expect(client.athletes.delete("o", "a")).resolves.toBeUndefined();
    await expect(client.me.registerPushToken({ token: "x", platform: "ios" })).resolves.toBeUndefined();
    const csv = await client.submissions.exportCsv("o", { form_id: "f", deidentified: true, start: "2026-01-01" });
    expect(csv).toBe("submission_id,athlete_code\n1,P-1\n");
    expect(calls[2]).toMatchObject({
      url: `${BASE}/orgs/o/submissions/export?form_id=f&deidentified=true&start=2026-01-01`,
      headers: { Authorization: "Bearer t1", Accept: "text/csv, text/plain, */*" },
    });
  });

  it("builds the export URL without fetching", () => {
    const { client, fetchMock } = setup();
    expect(client.submissions.exportUrl("o", { form_id: "f", group_id: "g", end: null })).toBe(
      `${BASE}/orgs/o/submissions/export?form_id=f&group_id=g`,
    );
    expect(client.url("/orgs/o", { x: 1 })).toBe(`${BASE}/orgs/o?x=1`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes an AbortSignal through", async () => {
    const { client, calls } = setup(() => json(200, {}));
    const ctrl = new AbortController();
    await client.me.get({ signal: ctrl.signal });
    expect(calls[0]!.signal).toBe(ctrl.signal);
  });

  it("uses the global fetch when none is given", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { ok: 1 }));
    try {
      const client = createApiClient({ baseUrl: BASE, getAccessToken: () => "g" });
      await expect(client.me.get()).resolves.toEqual({ ok: 1 });
      expect(spy).toHaveBeenCalledWith(`${BASE}/me`, expect.objectContaining({ method: "GET" }));
    } finally {
      spy.mockRestore();
    }
  });
});

describe("401 handling", () => {
  it("refreshes once and retries with the new token", async () => {
    const refresh = vi.fn(async () => {
      state.token = "t2";
      return true;
    });
    const onAuthFailure = vi.fn();
    const { client, calls, state } = setup(
      (c) => (c.headers.Authorization === "Bearer t2" ? json(200, { user: 1 }) : json(401, { detail: "expired" })),
      { refresh, onAuthFailure },
    );
    await expect(client.me.get()).resolves.toEqual({ user: 1 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(calls.map((c) => c.headers.Authorization)).toEqual(["Bearer t1", "Bearer t2"]);
  });

  it("shares one refresh between concurrent 401s", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const refresh = vi.fn(async () => {
      await gate;
      state.token = "t2";
      return true;
    });
    const { client, calls, state } = setup(
      (c) => (c.headers.Authorization === "Bearer t2" ? json(200, { url: c.url }) : json(401, { detail: "expired" })),
      { refresh },
    );
    const pending = Promise.all([client.me.get(), client.orgs.get("o"), client.athletes.list("o"), client.metrics.list("o")]);
    await new Promise((r) => setTimeout(r, 10));
    release();
    const results = await pending;
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(results.map((r) => (r as unknown as { url: string }).url)).toEqual([
      `${BASE}/me`,
      `${BASE}/orgs/o`,
      `${BASE}/orgs/o/athletes`,
      `${BASE}/orgs/o/metrics`,
    ]);
    expect(calls).toHaveLength(8);
  });

  it("does not refresh again when another request already rotated the token", async () => {
    const refresh = vi.fn(async () => true);
    const { client, calls, state } = setup(
      (c, n) => {
        if (n === 1) {
          state.token = "t2"; // e.g. a concurrent request refreshed while this one was in flight
          return json(401, { detail: "expired" });
        }
        return json(200, { ok: c.headers.Authorization });
      },
      { refresh },
    );
    await expect(client.me.get()).resolves.toEqual({ ok: "Bearer t2" });
    expect(refresh).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
  });

  it("calls onAuthFailure once and throws when the refresh fails", async () => {
    const refresh = vi.fn(async () => false);
    const onAuthFailure = vi.fn();
    const { client, calls } = setup(() => json(401, { detail: "Not authenticated" }), { refresh, onAuthFailure });
    const results = await Promise.allSettled([client.me.get(), client.orgs.get("o")]);
    for (const r of results) {
      expect(r.status).toBe("rejected");
      const e = (r as PromiseRejectedResult).reason as ApiError;
      expect(e).toBeInstanceOf(ApiError);
      expect(e).toMatchObject({ status: 401, detail: "Not authenticated" });
    }
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it("treats a throwing refresh as failure", async () => {
    const onAuthFailure = vi.fn();
    const { client } = setup(() => json(401, { detail: "x" }), {
      refresh: async () => {
        throw new Error("network");
      },
      onAuthFailure,
    });
    await expect(client.me.get()).rejects.toMatchObject({ status: 401 });
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("calls onAuthFailure when still 401 after the retry", async () => {
    const refresh = vi.fn(async () => {
      state.token = "t2";
      return true;
    });
    const onAuthFailure = vi.fn();
    const { client, calls, state } = setup(() => json(401, { detail: "revoked" }), { refresh, onAuthFailure });
    await expect(client.me.get()).rejects.toMatchObject({ status: 401, detail: "revoked" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it("calls onAuthFailure without a refresh option", async () => {
    const onAuthFailure = vi.fn();
    const { client, calls } = setup(() => json(401, { detail: "x" }), { onAuthFailure });
    await expect(client.me.get()).rejects.toBeInstanceOf(ApiError);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it("never refreshes for login, token refresh, invite acceptance or logout", async () => {
    const refresh = vi.fn(async () => true);
    const onAuthFailure = vi.fn();
    const { client, calls } = setup(() => json(401, { detail: "Invalid email or password" }), { refresh, onAuthFailure });
    await expect(client.auth.login({ email: "a@b.c", password: "x" })).rejects.toMatchObject({
      status: 401,
      detail: "Invalid email or password",
    });
    await expect(client.auth.refresh("r1")).rejects.toMatchObject({ status: 401 });
    await expect(client.auth.acceptInvite({ token: "t", password: "p", full_name: "F" })).rejects.toMatchObject({ status: 401 });
    await expect(client.auth.logout("r1")).rejects.toMatchObject({ status: 401 });
    expect(refresh).not.toHaveBeenCalled();
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(calls.map((c) => c.headers.Authorization)).toEqual([undefined, undefined, undefined, "Bearer t1"]);
    expect(calls[1]!.body).toBe(JSON.stringify({ refresh_token: "r1" }));
  });
});

describe("errors", () => {
  it("parses submission field errors", async () => {
    const { client } = setup(() =>
      json(422, { detail: { message: "invalid submission", field_errors: { rpe: "required", mood: "unknown_field" } } }),
    );
    const err = await client.self.submit("o", { form_id: "f", values: {} }).catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    expect(err).toMatchObject({
      status: 422,
      detail: "invalid submission",
      message: "invalid submission",
      name: "ApiError",
      fieldErrors: { rpe: "required", mood: "unknown_field" },
    });
    expect((err as ApiError).schemaErrors).toBeUndefined();
  });

  it("parses publish schema errors", async () => {
    const { client } = setup(() =>
      json(422, {
        detail: { message: "invalid schema", schema_errors: [{ path: "sections/0/fields", message: "empty" }] },
      }),
    );
    await expect(client.forms.publish("o", "f")).rejects.toMatchObject({
      status: 422,
      detail: "invalid schema",
      schemaErrors: [{ path: "sections/0/fields", message: "empty" }],
    });
  });

  it("parses FastAPI request-validation errors", async () => {
    const { client } = setup(() =>
      json(422, {
        detail: [
          { loc: ["body", "email"], msg: "value is not a valid email address", type: "value_error" },
          { loc: ["query", "limit"], msg: "Input should be less than or equal to 500", type: "less_than_equal" },
        ],
      }),
    );
    const err = (await client.athletes.list("o", { limit: 1000 }).catch((e: unknown) => e)) as ApiError;
    expect(err.detail).toBe("email: value is not a valid email address; limit: Input should be less than or equal to 500");
    expect(err.validationErrors).toHaveLength(2);
    expect(err.validationErrors![0]).toMatchObject({ loc: ["body", "email"], type: "value_error" });
  });

  it("handles detail strings, non-JSON bodies and empty bodies", async () => {
    const responses = [
      json(409, { detail: "A submission already exists for this day" }),
      new Response("Bad gateway", { status: 502, statusText: "Bad Gateway" }),
      new Response(null, { status: 500, statusText: "Internal Server Error" }),
      new Response("", { status: 403 }),
    ];
    const { client } = setup((_c, n) => responses[n - 1]!);
    const errs: ApiError[] = [];
    for (let i = 0; i < 4; i++) errs.push((await client.me.get().catch((e: unknown) => e)) as ApiError);
    expect(errs.map((e) => [e.status, e.detail])).toEqual([
      [409, "A submission already exists for this day"],
      [502, "Bad gateway"],
      [500, "Internal Server Error"],
      [403, "Request failed with status 403"],
    ]);
    expect(errs[1]!.body).toBe("Bad gateway");
  });
});

describe("imports.preview uploads", () => {
  it("sends a Blob/File as multipart without a JSON content type", async () => {
    const { client, calls } = setup(() => json(200, { upload_id: "u" }));
    const file = new File(["code,rpe\nP-1,7\n"], "session.csv", { type: "text/csv" });
    await client.imports.preview("o", "f", file);
    const call = calls[0]!;
    expect(call.url).toBe(`${BASE}/orgs/o/forms/f/imports/preview`);
    expect(call.method).toBe("POST");
    expect(call.headers["Content-Type"]).toBeUndefined();
    expect(call.headers.Authorization).toBe("Bearer t1");
    const fd = call.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    const part = fd.get("file") as File;
    expect(part.name).toBe("session.csv");
    expect(await part.text()).toBe("code,rpe\nP-1,7\n");
  });

  it("names a bare Blob after its type, or as given", async () => {
    const { client, calls } = setup(() => json(200, {}));
    await client.imports.preview("o", "f", new Blob(["x"], { type: "text/csv" }));
    await client.imports.preview(
      "o",
      "f",
      new Blob(["x"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    );
    await client.imports.preview("o", "f", new Blob(["x"]), { filename: "gps.csv" });
    expect(calls.map((c) => ((c.body as FormData).get("file") as File).name)).toEqual([
      "upload.csv",
      "upload.xlsx",
      "gps.csv",
    ]);
  });

  it("passes React Native {uri, name, type} objects to FormData.append as is", async () => {
    const append = vi.spyOn(FormData.prototype, "append");
    try {
      const { client, calls } = setup(() => json(200, {}));
      const rnFile = { uri: "file:///tmp/session.csv", name: "session.csv", type: "text/csv" };
      await client.imports.preview("o", "f", rnFile);
      expect(append).toHaveBeenCalledWith("file", rnFile);
      expect(calls[0]!.body).toBeInstanceOf(FormData);
    } finally {
      append.mockRestore();
    }
  });

  it("retries the same multipart body after a refresh", async () => {
    const refresh = vi.fn(async () => {
      state.token = "t2";
      return true;
    });
    const { client, calls, state } = setup(
      (c) => (c.headers.Authorization === "Bearer t2" ? json(200, { upload_id: "u" }) : json(401, { detail: "x" })),
      { refresh },
    );
    await expect(client.imports.preview("o", "f", new Blob(["a"]))).resolves.toEqual({ upload_id: "u" });
    expect(calls[1]!.body).toBe(calls[0]!.body);
  });
});

describe("endpoint coverage (docs/API.md)", () => {
  const schema: FormSchema = { schema_version: 1, sections: [] };
  const cases: [string, (c: ApiClient) => Promise<unknown>, string, string][] = [
    // Auth and identity
    ["POST /auth/login", (c) => c.auth.login({ email: "e", password: "p" }), "POST", "/auth/login"],
    ["POST /auth/refresh", (c) => c.auth.refresh("r"), "POST", "/auth/refresh"],
    ["POST /auth/logout", (c) => c.auth.logout("r"), "POST", "/auth/logout"],
    ["GET /auth/invite/{token}", (c) => c.auth.getInvite("tok"), "GET", "/auth/invite/tok"],
    ["POST /auth/accept-invite", (c) => c.auth.acceptInvite({ token: "t", password: "p", full_name: "n" }), "POST", "/auth/accept-invite"],
    ["GET /me", (c) => c.me.get(), "GET", "/me"],
    ["PATCH /me", (c) => c.me.update({ full_name: "n" }), "PATCH", "/me"],
    ["POST /me/push-tokens", (c) => c.me.registerPushToken({ token: "x", platform: "android" }), "POST", "/me/push-tokens"],
    ["DELETE /me/push-tokens/{token}", (c) => c.me.deletePushToken("ExponentPushToken[x]"), "DELETE", "/me/push-tokens/ExponentPushToken%5Bx%5D"],
    // Organization, members, invitations
    ["GET /orgs/{org_id}", (c) => c.orgs.get("o"), "GET", "/orgs/o"],
    ["PATCH /orgs/{org_id}", (c) => c.orgs.update("o", { name: "n" }), "PATCH", "/orgs/o"],
    ["GET members", (c) => c.members.list("o"), "GET", "/orgs/o/members"],
    ["PATCH member", (c) => c.members.update("o", "u", { role: "staff" }), "PATCH", "/orgs/o/members/u"],
    ["DELETE member", (c) => c.members.delete("o", "u"), "DELETE", "/orgs/o/members/u"],
    ["GET invitations", (c) => c.invitations.list("o"), "GET", "/orgs/o/invitations"],
    ["POST invitations", (c) => c.invitations.create("o", { email: "e", role: "staff" }), "POST", "/orgs/o/invitations"],
    ["DELETE invitation", (c) => c.invitations.delete("o", "i"), "DELETE", "/orgs/o/invitations/i"],
    ["POST athlete invite", (c) => c.athletes.invite("o", "a"), "POST", "/orgs/o/athletes/a/invite"],
    // Groups and staff assignments
    ["GET groups", (c) => c.groups.list("o", { include_archived: false }), "GET", "/orgs/o/groups?include_archived=false"],
    ["POST groups", (c) => c.groups.create("o", { name: "n", kind: "team" }), "POST", "/orgs/o/groups"],
    ["GET group", (c) => c.groups.get("o", "g"), "GET", "/orgs/o/groups/g"],
    ["PATCH group", (c) => c.groups.update("o", "g", { archived: true }), "PATCH", "/orgs/o/groups/g"],
    ["DELETE group", (c) => c.groups.delete("o", "g"), "DELETE", "/orgs/o/groups/g"],
    ["POST group athletes", (c) => c.groups.addAthletes("o", "g", { athlete_ids: ["a"] }), "POST", "/orgs/o/groups/g/athletes"],
    ["DELETE group athlete", (c) => c.groups.removeAthlete("o", "g", "a", { left_on: "2026-10-12" }), "DELETE", "/orgs/o/groups/g/athletes/a?left_on=2026-10-12"],
    ["GET group staff", (c) => c.staffAssignments.list("o", "g"), "GET", "/orgs/o/groups/g/staff"],
    ["POST group staff", (c) => c.staffAssignments.create("o", "g", { user_id: "u", access_role: "coach" }), "POST", "/orgs/o/groups/g/staff"],
    ["DELETE staff assignment", (c) => c.staffAssignments.delete("o", "s"), "DELETE", "/orgs/o/staff-assignments/s"],
    // Athletes
    ["GET athletes", (c) => c.athletes.list("o", { group_id: "g", status: "active" }), "GET", "/orgs/o/athletes?group_id=g&status=active"],
    ["POST athletes", (c) => c.athletes.create("o", { first_name: "f", last_name: "l" }), "POST", "/orgs/o/athletes"],
    ["GET athlete", (c) => c.athletes.get("o", "a"), "GET", "/orgs/o/athletes/a"],
    ["PATCH athlete", (c) => c.athletes.update("o", "a", { status: "inactive" }), "PATCH", "/orgs/o/athletes/a"],
    ["DELETE athlete", (c) => c.athletes.delete("o", "a"), "DELETE", "/orgs/o/athletes/a"],
    // Forms, versions, templates, schedules
    ["GET forms", (c) => c.forms.list("o", { kind: "session", include_archived: true }), "GET", "/orgs/o/forms?kind=session&include_archived=true"],
    ["POST forms", (c) => c.forms.create("o", { name: "n", kind: "questionnaire" }), "POST", "/orgs/o/forms"],
    ["GET form", (c) => c.forms.get("o", "f"), "GET", "/orgs/o/forms/f"],
    ["PATCH form", (c) => c.forms.update("o", "f", { draft_schema: schema }), "PATCH", "/orgs/o/forms/f"],
    ["POST publish", (c) => c.forms.publish("o", "f"), "POST", "/orgs/o/forms/f/publish"],
    ["GET versions", (c) => c.forms.versions("o", "f"), "GET", "/orgs/o/forms/f/versions"],
    ["POST validate-schema", (c) => c.forms.validateSchema("o", schema), "POST", "/orgs/o/forms/validate-schema"],
    ["GET form-templates", (c) => c.formTemplates.list("o"), "GET", "/orgs/o/form-templates"],
    ["POST template install", (c) => c.formTemplates.install("o", "session_rpe", { name: "sRPE" }), "POST", "/orgs/o/form-templates/session_rpe/install"],
    ["GET schedules", (c) => c.schedules.list("o", "f"), "GET", "/orgs/o/forms/f/schedules"],
    [
      "POST schedules",
      (c) =>
        c.schedules.create("o", "f", {
          group_id: "g",
          recurrence: "weekly",
          days_of_week: [1, 3],
          due_time: "09:00",
          start_date: "2026-10-12",
          end_date: null,
          remind: true,
          active: true,
        }),
      "POST",
      "/orgs/o/forms/f/schedules",
    ],
    ["PATCH schedule", (c) => c.schedules.update("o", "s", { active: false }), "PATCH", "/orgs/o/form-schedules/s"],
    ["DELETE schedule", (c) => c.schedules.delete("o", "s"), "DELETE", "/orgs/o/form-schedules/s"],
    // Submissions
    ["GET submissions", (c) => c.submissions.list("o", { form_id: "f", source: "import", start: "2026-10-01" }), "GET", "/orgs/o/submissions?form_id=f&source=import&start=2026-10-01"],
    ["POST submissions", (c) => c.submissions.create("o", { form_id: "f", athlete_id: "a", values: {} }), "POST", "/orgs/o/submissions"],
    ["POST bulk", (c) => c.submissions.bulkCreate("o", { form_id: "f", local_date: "2026-10-12", entries: [] }), "POST", "/orgs/o/submissions/bulk"],
    ["GET submission", (c) => c.submissions.get("o", "s"), "GET", "/orgs/o/submissions/s"],
    ["PATCH submission", (c) => c.submissions.update("o", "s", { values: { a: 1 } }), "PATCH", "/orgs/o/submissions/s"],
    ["DELETE submission", (c) => c.submissions.delete("o", "s"), "DELETE", "/orgs/o/submissions/s"],
    ["GET export", (c) => c.submissions.exportCsv("o", { form_id: "f" }), "GET", "/orgs/o/submissions/export?form_id=f"],
    // Imports
    ["POST import preview", (c) => c.imports.preview("o", "f", new Blob(["x"])), "POST", "/orgs/o/forms/f/imports/preview"],
    [
      "POST import commit",
      (c) =>
        c.imports.commit("o", "f", { upload_id: "u", mapping: {}, athlete_column: "code", athlete_match: "code", date_column: null }),
      "POST",
      "/orgs/o/forms/f/imports",
    ],
    ["GET imports", (c) => c.imports.list("o", { form_id: "f" }), "GET", "/orgs/o/imports?form_id=f"],
    ["DELETE import", (c) => c.imports.delete("o", "b"), "DELETE", "/orgs/o/imports/b"],
    // Athlete self-service
    ["GET me/athlete", (c) => c.self.athlete("o"), "GET", "/orgs/o/me/athlete"],
    ["GET me/forms", (c) => c.self.forms("o", { date: "2026-10-12" }), "GET", "/orgs/o/me/forms?date=2026-10-12"],
    ["GET me/submissions", (c) => c.self.submissions("o", { form_id: "f", limit: 10 }), "GET", "/orgs/o/me/submissions?form_id=f&limit=10"],
    ["POST me/submissions", (c) => c.self.submit("o", { form_id: "f", values: {} }), "POST", "/orgs/o/me/submissions"],
    ["GET me/metrics", (c) => c.self.metrics("o", { start: "2026-09-01", end: "2026-10-12" }), "GET", "/orgs/o/me/metrics?start=2026-09-01&end=2026-10-12"],
    ["GET me/wearables", (c) => c.self.wearables("o"), "GET", "/orgs/o/me/wearables"],
    ["GET me/wearables/providers", (c) => c.self.wearableProviders("o"), "GET", "/orgs/o/me/wearables/providers"],
    ["POST me/wearables/connect", (c) => c.self.connectWearable("o", { provider: "oura" }), "POST", "/orgs/o/me/wearables/connect"],
    ["POST me/wearables/sdk-token", (c) => c.self.wearableSdkToken("o"), "POST", "/orgs/o/me/wearables/sdk-token"],
    // Wearables (staff)
    ["GET wearables/providers", (c) => c.wearables.providers("o"), "GET", "/orgs/o/wearables/providers"],
    ["GET athlete wearables", (c) => c.wearables.status("o", "a"), "GET", "/orgs/o/athletes/a/wearables"],
    ["POST wearables/link", (c) => c.wearables.link("o", "a"), "POST", "/orgs/o/athletes/a/wearables/link"],
    ["POST wearables/connect", (c) => c.wearables.connect("o", "a", { provider: "garmin", account_label: "left" }), "POST", "/orgs/o/athletes/a/wearables/connect"],
    ["POST wearables/refresh", (c) => c.wearables.refresh("o", "a", { days: 7 }), "POST", "/orgs/o/athletes/a/wearables/refresh?days=7"],
    ["GET wearables/daily", (c) => c.wearables.daily("o", "a", { metrics: ["steps"] }), "GET", "/orgs/o/athletes/a/wearables/daily?metrics=steps"],
    // Metrics and dashboards
    ["GET metrics", (c) => c.metrics.list("o"), "GET", "/orgs/o/metrics"],
    [
      "POST metrics",
      (c) =>
        c.metrics.create("o", {
          slug: "load",
          name: "Load",
          description: null,
          unit: "AU",
          source: "form:session_rpe.srpe",
          daily_agg: "sum",
          fill_zero: true,
          transform: "none",
          params: {},
          thresholds: null,
          decimals: 0,
          athlete_visible: true,
        }),
      "POST",
      "/orgs/o/metrics",
    ],
    ["PATCH metric", (c) => c.metrics.update("o", "m", { decimals: 1 }), "PATCH", "/orgs/o/metrics/m"],
    ["DELETE metric", (c) => c.metrics.delete("o", "m"), "DELETE", "/orgs/o/metrics/m"],
    ["GET series-sources", (c) => c.metrics.seriesSources("o"), "GET", "/orgs/o/series-sources"],
    ["GET metric series", (c) => c.metrics.series("o", "acwr", { athlete_id: "a", start: "2026-09-01" }), "GET", "/orgs/o/metrics/acwr/series?athlete_id=a&start=2026-09-01"],
    ["GET readiness", (c) => c.dashboards.readiness("o", { group_id: "g", date: "2026-10-12" }), "GET", "/orgs/o/dashboards/readiness?group_id=g&date=2026-10-12"],
    ["GET audit", (c) => c.audit.list("o", { entity_type: "submission", limit: 20 }), "GET", "/orgs/o/audit?entity_type=submission&limit=20"],
  ];

  it.each(cases)("%s", async (_name, invoke, method, path) => {
    const { client, calls } = setup(() => json(200, {}));
    await invoke(client);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe(method);
    expect(calls[0]!.url).toBe(`${BASE}${path}`);
  });

  it("covers every endpoint row of API.md", () => {
    // 9 auth/identity + 9 org/members/invitations + 10 groups/staff + 5 athletes + 13 forms
    // + 7 submissions + 4 imports + 9 self-service + 6 staff wearables + 8 metrics/dashboards/audit.
    // (The OW webhook is server-to-server and has no client method.)
    expect(cases).toHaveLength(80);
    expect(new Set(cases.map((c) => `${c[2]} ${c[3].split("?")[0]}`)).size).toBe(80);
  });
});
