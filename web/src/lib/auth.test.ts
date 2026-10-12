import { describe, expect, it, vi } from "vitest";
import { createAuthedApiClient, createTokenStore } from "@/lib/auth";
import { apiBaseUrl } from "@/lib/config";

const BASE = "http://api.test/api/v1";

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const me = { user: { id: "u1", email: "a@example.com", full_name: "A", is_active: true, created_at: "" }, memberships: [] };

describe("token store", () => {
  it("persists the pair in localStorage and restores it", () => {
    const store = createTokenStore(() => 1_000);
    store.setPair({ access_token: "acc", refresh_token: "ref", expires_in: 60 });
    expect(localStorage.getItem("ams.access_token")).toBe("acc");
    expect(localStorage.getItem("ams.refresh_token")).toBe("ref");
    const again = createTokenStore();
    expect(again.getAccessToken()).toBe("acc");
    expect(again.getRefreshToken()).toBe("ref");
    expect(again.get()?.expiresAt).toBe(61_000);
    again.clear();
    expect(localStorage.getItem("ams.refresh_token")).toBeNull();
    expect(createTokenStore().isAuthenticated()).toBe(false);
  });
});

describe("authed API client", () => {
  it("refreshes once on 401, stores the rotated pair and retries with the new token", async () => {
    const store = createTokenStore();
    store.setPair({ access_token: "old", refresh_token: "r1", expires_in: 1800 });
    const calls: { url: string; auth: string | null; body?: string }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, auth: headers.Authorization ?? null, body: init?.body as string | undefined });
      if (url.endsWith("/auth/refresh")) {
        return json(200, { access_token: "new", refresh_token: "r2", token_type: "bearer", expires_in: 1800 });
      }
      return headers.Authorization === "Bearer new" ? json(200, me) : json(401, { detail: "expired" });
    });
    const onLogout = vi.fn();
    const api = createAuthedApiClient({ baseUrl: BASE, store, fetch: fetchMock as unknown as typeof fetch, onLogout });

    // Two concurrent requests share one refresh.
    const [a, b] = await Promise.all([api.me.get(), api.me.get()]);
    expect(a).toEqual(me);
    expect(b).toEqual(me);
    const refreshCalls = calls.filter((c) => c.url.endsWith("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
    expect(JSON.parse(refreshCalls[0]!.body!)).toEqual({ refresh_token: "r1" });
    expect(refreshCalls[0]!.auth).toBeNull();
    expect(store.getAccessToken()).toBe("new");
    expect(store.getRefreshToken()).toBe("r2");
    expect(localStorage.getItem("ams.refresh_token")).toBe("r2");
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("logs out when the refresh fails", async () => {
    const store = createTokenStore();
    store.setPair({ access_token: "old", refresh_token: "revoked", expires_in: 1800 });
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/auth/refresh") ? json(401, { detail: "revoked" }) : json(401, { detail: "expired" }),
    );
    const onLogout = vi.fn();
    const api = createAuthedApiClient({ baseUrl: BASE, store, fetch: fetchMock as unknown as typeof fetch, onLogout });
    await expect(api.me.get()).rejects.toMatchObject({ status: 401 });
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(store.isAuthenticated()).toBe(false);
    expect(localStorage.getItem("ams.access_token")).toBeNull();
  });

  it("refreshes on first use when only a refresh token survived the reload", async () => {
    localStorage.setItem("ams.refresh_token", "r1");
    const store = createTokenStore();
    expect(store.getAccessToken()).toBeNull();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url.endsWith("/auth/refresh")) return json(200, { access_token: "fresh", refresh_token: "r2", token_type: "bearer", expires_in: 60 });
      return headers.Authorization === "Bearer fresh" ? json(200, me) : json(401, { detail: "missing" });
    });
    const api = createAuthedApiClient({ baseUrl: BASE, store, fetch: fetchMock as unknown as typeof fetch });
    await expect(api.me.get()).resolves.toEqual(me);
    expect(store.getAccessToken()).toBe("fresh");
  });

  it("builds the /api/v1 base URL from VITE_API_URL", () => {
    expect(apiBaseUrl(undefined)).toBe("http://localhost:8001/api/v1");
    expect(apiBaseUrl("https://ams.example.org/")).toBe("https://ams.example.org/api/v1");
    expect(apiBaseUrl("https://ams.example.org/api/v1")).toBe("https://ams.example.org/api/v1");
  });
});
