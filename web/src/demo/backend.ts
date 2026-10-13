/**
 * The in-browser fake AMS API. `createDemoFetch()` returns a `fetch` that answers
 * `/api/v1/...` from an in-memory store per demo login, loaded lazily from
 * `demo/<role>.json` on the first request that needs it.
 *
 * Auth accepts only the demo accounts and hands out tokens that name the role
 * (`demo.<role>.<random>`), so a reload keeps the session and starts from fresh data.
 * Endpoints the demo does not implement answer 501 `{detail: "Not available in the demo"}`.
 */
import { DEMO_ACCOUNTS, DEMO_PASSWORD, roleForEmail } from "./accounts";
import { fetchFixture, type DemoRole, type FixtureLoader } from "./fixture";
import { formRoutes } from "./handlers/forms";
import { importRoutes } from "./handlers/imports";
import { insightRoutes } from "./handlers/insights";
import { findInvitation, peopleRoutes } from "./handlers/people";
import { submissionRoutes } from "./handlers/submissions";
import { HttpError, NOT_IN_DEMO, fail, json, noContent, record, type DemoRequest, type DemoResponse } from "./http";
import { compileRoutes, makeCtx } from "./router";
import { DemoStore, newId } from "./store";

export const DEMO_API_BASE = "/api/v1";
const ACCESS_TTL_SECONDS = 3600;
const ROLES: readonly DemoRole[] = DEMO_ACCOUNTS.map((a) => a.role);

const match = compileRoutes([...peopleRoutes, ...formRoutes, ...submissionRoutes, ...importRoutes, ...insightRoutes]);

export interface DemoBackendOptions {
  load?: FixtureLoader;
  /** Artificial response delay in ms, so loading states show as they would against a server. */
  latency?: number;
  /** Called after a successful demo sign-in. */
  onLogin?: (role: DemoRole) => void;
}

function tokenPair(role: DemoRole) {
  const nonce = newId().replace(/-/g, "");
  return {
    access_token: `demo.${role}.${nonce}`,
    refresh_token: `demo-refresh.${role}.${nonce}`,
    token_type: "bearer" as const,
    expires_in: ACCESS_TTL_SECONDS,
  };
}

function roleOfToken(token: string | null | undefined, prefix: string): DemoRole | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== prefix) return null;
  return ROLES.includes(parts[1] as DemoRole) ? (parts[1] as DemoRole) : null;
}

export class DemoBackend {
  private readonly load: FixtureLoader;
  private readonly stores = new Map<DemoRole, Promise<DemoStore>>();
  readonly latency: number;
  private readonly onLogin: ((role: DemoRole) => void) | undefined;

  constructor(options: DemoBackendOptions = {}) {
    this.load = options.load ?? fetchFixture();
    this.latency = options.latency ?? 0;
    this.onLogin = options.onLogin;
  }

  /** The store of a login, loading its fixture on first use. */
  store(role: DemoRole): Promise<DemoStore> {
    let s = this.stores.get(role);
    if (!s) {
      s = this.load(role).then((f) => new DemoStore(f));
      s.catch(() => this.stores.delete(role));
      this.stores.set(role, s);
    }
    return s;
  }

  async handle(req: DemoRequest): Promise<DemoResponse> {
    try {
      return await this.route(req);
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: e.body };
      console.error("[demo]", e);
      return { status: 500, body: { detail: `Demo error: ${e instanceof Error ? e.message : String(e)}` } };
    }
  }

  private async storeOrFail(role: DemoRole): Promise<DemoStore> {
    try {
      return await this.store(role);
    } catch (e) {
      throw fail(503, e instanceof Error ? e.message : "Could not load the demo data.");
    }
  }

  private async route(req: DemoRequest): Promise<DemoResponse> {
    const { method, path } = req;
    if (path === "/health" && method === "GET") return json({ status: "ok" });

    // ------------------------------------------------------------ public auth
    if (path === "/auth/login" && method === "POST") {
      const body = record(req.body);
      const email = String(body.email ?? "").trim().toLowerCase();
      const role = roleForEmail(email);
      if (!role || body.password !== DEMO_PASSWORD) throw fail(401, "invalid email or password");
      const store = await this.storeOrFail(role);
      this.onLogin?.(role);
      return json({ ...tokenPair(role), user: store.fixture.me.user });
    }
    if (path === "/auth/refresh" && method === "POST") {
      const role = roleOfToken(String(record(req.body).refresh_token ?? ""), "demo-refresh");
      if (!role) throw fail(401, "invalid refresh token");
      return json(tokenPair(role));
    }
    if (path === "/auth/logout" && method === "POST") return noContent();
    const invite = /^\/auth\/invite\/([^/]+)$/.exec(path);
    if (invite && method === "GET") {
      for (const s of this.stores.values()) {
        const store = await s.catch(() => null);
        const inv = store ? findInvitation(store, decodeURIComponent(invite[1]!)) : undefined;
        if (store && inv) return json({ email: inv.email, org_name: store.org.name, role: inv.role, expires_at: inv.expires_at });
      }
      throw fail(404, "invitation not found or expired");
    }
    if (path === "/auth/accept-invite" && method === "POST") {
      throw fail(501, "Accepting invitations is not available in the demo. Sign in with one of the demo roles instead.");
    }

    // ------------------------------------------------------------ authenticated
    const auth = req.headers.authorization ?? "";
    const role = roleOfToken(auth.replace(/^Bearer\s+/i, ""), "demo");
    if (!role) throw fail(401, "not authenticated");
    const store = await this.storeOrFail(role);

    if (path === "/me") {
      if (method === "GET") return json(store.fixture.me);
      if (method === "PATCH") {
        const body = record(req.body);
        if (body.password !== undefined && body.current_password !== DEMO_PASSWORD) throw fail(400, "current password is incorrect");
        const user = store.fixture.me.user;
        if (typeof body.full_name === "string") user.full_name = body.full_name;
        return json(user);
      }
    }
    if (path === "/me/push-tokens" || path.startsWith("/me/push-tokens/")) return noContent();

    const orgMatch = /^\/orgs\/([^/]+)(?:\/|$)/.exec(path);
    if (orgMatch && decodeURIComponent(orgMatch[1]!) !== store.orgId) throw fail(404, "organization not found");
    const found = match(method, path);
    if (!found) {
      console.warn(`[demo] ${method} ${path}: ${NOT_IN_DEMO}`);
      throw fail(501, NOT_IN_DEMO);
    }
    return found.handler(makeCtx(req, found.params, store));
  }
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (!h) return out;
  if (h instanceof Headers) h.forEach((v, k) => (out[k.toLowerCase()] = v));
  else if (Array.isArray(h)) for (const [k, v] of h) out[k.toLowerCase()] = v;
  else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

/** A `fetch` that answers `/api/v1/...` from the demo backend. */
export function createDemoFetch(options: DemoBackendOptions = {}): typeof fetch & { backend: DemoBackend } {
  const backend = new DemoBackend(options);
  const demoFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "https://demo.invalid");
    const prefix = url.pathname.indexOf(DEMO_API_BASE);
    if (prefix < 0) return fetch(input, init);
    let body: unknown = undefined;
    let formData: FormData | null = null;
    if (init?.body instanceof FormData) formData = init.body;
    else if (typeof init?.body === "string" && init.body !== "") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const res = await backend.handle({
      method: (init?.method ?? "GET").toUpperCase(),
      path: url.pathname.slice(prefix + DEMO_API_BASE.length) || "/",
      query: url.searchParams,
      body,
      formData,
      headers: headersOf(init),
    });
    if (backend.latency > 0) await new Promise((r) => setTimeout(r, backend.latency * (0.6 + Math.random() * 0.8)));
    if (res.status === 204 || (res.body === undefined && res.text === undefined)) return new Response(null, { status: res.status });
    if (res.text !== undefined) {
      return new Response(res.text, { status: res.status, headers: { "Content-Type": res.contentType ?? "text/plain" } });
    }
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { "Content-Type": "application/json" } });
  };
  return Object.assign(demoFetch as typeof fetch, { backend });
}
