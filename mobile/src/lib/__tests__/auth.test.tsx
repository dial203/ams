import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { QueryClient } from "@tanstack/react-query";
import { createAmsApi } from "../api";
import { createTokenStore } from "../auth/tokens";
import { SessionProvider, useSession, type SessionContextValue } from "../session/SessionProvider";
import { createSignal } from "../signal";
import { memoryStorage, STORAGE_KEYS } from "../storage";
import { createFetchMock, networkError, type MockHandler } from "../../test/fetchMock";
import { me } from "../../test/fixtures";

const BASE = "https://ams.test/api/v1";

function setup(routes: Record<string, MockHandler>, stored: Record<string, string> = {}) {
  const storage = memoryStorage(stored);
  const tokens = createTokenStore(storage);
  const onSessionExpired = jest.fn();
  const mock = createFetchMock(routes);
  const api = createAmsApi({ baseUrl: BASE, tokens, onSessionExpired, fetch: mock.fetch });
  return { storage, tokens, onSessionExpired, api, ...mock };
}

const authHeader = (req: { headers: Record<string, string> }) => req.headers.Authorization;

describe("API client wiring", () => {
  it("sends the stored access token", async () => {
    const t = setup({ "GET /me": { body: me } }, { [STORAGE_KEYS.accessToken]: "a1", [STORAGE_KEYS.refreshToken]: "r1" });
    await t.tokens.load();
    await expect(t.api.me.get()).resolves.toEqual(me);
    expect(authHeader(t.calls[0]!)).toBe("Bearer a1");
  });

  it("on 401 rotates the refresh token once, stores the new pair and retries", async () => {
    const t = setup(
      {
        "GET /me": (req) => (authHeader(req) === "Bearer a2" ? { body: me } : { status: 401, body: { detail: "expired" } }),
        "POST /auth/refresh": (req) =>
          (req.body as { refresh_token: string }).refresh_token === "r1"
            ? { body: { access_token: "a2", refresh_token: "r2", token_type: "bearer", expires_in: 900 } }
            : { status: 401, body: { detail: "revoked" } },
      },
      { [STORAGE_KEYS.accessToken]: "a1", [STORAGE_KEYS.refreshToken]: "r1" },
    );
    await t.tokens.load();

    // Two concurrent requests share one refresh.
    const [a, b] = await Promise.all([t.api.me.get(), t.api.me.get()]);
    expect(a).toEqual(me);
    expect(b).toEqual(me);
    expect(t.callsTo("POST /auth/refresh")).toHaveLength(1);
    expect(t.tokens.getAccessToken()).toBe("a2");
    expect(t.storage.data.get(STORAGE_KEYS.refreshToken)).toBe("r2");
    expect(t.onSessionExpired).not.toHaveBeenCalled();
  });

  it("ends the session when the refresh token is rejected", async () => {
    const t = setup(
      {
        "GET /me": { status: 401, body: { detail: "expired" } },
        "POST /auth/refresh": { status: 401, body: { detail: "revoked" } },
      },
      { [STORAGE_KEYS.accessToken]: "a1", [STORAGE_KEYS.refreshToken]: "r1" },
    );
    await t.tokens.load();
    await expect(t.api.me.get()).rejects.toMatchObject({ status: 401 });
    expect(t.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("keeps the session when the refresh fails for lack of network", async () => {
    const t = setup(
      {
        "GET /me": { status: 401, body: { detail: "expired" } },
        "POST /auth/refresh": () => networkError(),
      },
      { [STORAGE_KEYS.accessToken]: "a1", [STORAGE_KEYS.refreshToken]: "r1" },
    );
    await t.tokens.load();
    await expect(t.api.me.get()).rejects.toMatchObject({ status: 401 });
    expect(t.onSessionExpired).not.toHaveBeenCalled();
    expect(t.tokens.getRefreshToken()).toBe("r1");
  });
});

function Probe({ onValue }: { onValue: (v: SessionContextValue) => void }) {
  const session = useSession();
  onValue(session);
  return <Text>{`status:${session.status} expired:${String(session.expired)}`}</Text>;
}

describe("SessionProvider", () => {
  async function renderSession(routes: Record<string, MockHandler>, stored: Record<string, string> = {}) {
    const t = setup(routes, stored);
    const sessionExpired = createSignal();
    const queryClient = new QueryClient();
    const beforeSignOut = jest.fn(async () => undefined);
    const afterSignOut = jest.fn(async () => undefined);
    let current: SessionContextValue | null = null;
    await render(
      <SessionProvider
        api={t.api}
        tokens={t.tokens}
        storage={t.storage}
        queryClient={queryClient}
        sessionExpired={sessionExpired}
        beforeSignOut={beforeSignOut}
        afterSignOut={afterSignOut}
      >
        <Probe onValue={(v) => (current = v)} />
      </SessionProvider>,
    );
    return { ...t, sessionExpired, beforeSignOut, afterSignOut, session: () => current! };
  }

  it("starts signed out without tokens, and signs in with POST /auth/login", async () => {
    const t = await renderSession({
      "POST /auth/login": {
        body: { access_token: "a1", refresh_token: "r1", token_type: "bearer", expires_in: 900, user: me.user },
      },
    });
    expect(await screen.findByText("status:signedOut expired:false")).toBeOnTheScreen();
    await act(() => t.session().signIn(" sam@example.org ", "pw"));
    expect(t.callsTo("POST /auth/login")[0]!.body).toEqual({ email: "sam@example.org", password: "pw" });
    expect(screen.getByText("status:signedIn expired:false")).toBeOnTheScreen();
    expect(t.storage.data.get(STORAGE_KEYS.accessToken)).toBe("a1");
    expect(t.storage.data.get(STORAGE_KEYS.refreshToken)).toBe("r1");
  });

  it("restores a stored session and the remembered org", async () => {
    const t = await renderSession({}, { [STORAGE_KEYS.refreshToken]: "r1", [STORAGE_KEYS.orgId]: "org-2" });
    expect(await screen.findByText("status:signedIn expired:false")).toBeOnTheScreen();
    expect(t.session().storedOrgId).toBe("org-2");
  });

  it("goes back to login when the API reports the session expired", async () => {
    const t = await renderSession({}, { [STORAGE_KEYS.accessToken]: "a1", [STORAGE_KEYS.refreshToken]: "r1" });
    await screen.findByText("status:signedIn expired:false");
    await act(async () => {
      t.sessionExpired.emit();
    });
    expect(await screen.findByText("status:signedOut expired:true")).toBeOnTheScreen();
    expect(t.storage.data.has(STORAGE_KEYS.refreshToken)).toBe(false);
    expect(t.afterSignOut).toHaveBeenCalled();
  });

  it("signs out: removes the push token first, revokes the refresh token, clears storage", async () => {
    const t = await renderSession(
      { "POST /auth/logout": { status: 204 } },
      { [STORAGE_KEYS.accessToken]: "a1", [STORAGE_KEYS.refreshToken]: "r1" },
    );
    await screen.findByText("status:signedIn expired:false");
    await act(() => t.session().signOut());
    expect(t.beforeSignOut).toHaveBeenCalled();
    expect(t.callsTo("POST /auth/logout")[0]!.body).toEqual({ refresh_token: "r1" });
    expect(t.afterSignOut).toHaveBeenCalled();
    expect(screen.getByText("status:signedOut expired:false")).toBeOnTheScreen();
    expect(t.storage.data.size).toBe(0);
  });

  it("rotates once to revoke when the access token expired before logout", async () => {
    const t = await renderSession(
      {
        "POST /auth/logout": (req) => (authHeader(req) === "Bearer a2" ? { status: 204 } : { status: 401, body: { detail: "expired" } }),
        "POST /auth/refresh": { body: { access_token: "a2", refresh_token: "r2", token_type: "bearer", expires_in: 900 } },
      },
      { [STORAGE_KEYS.accessToken]: "a1", [STORAGE_KEYS.refreshToken]: "r1" },
    );
    await screen.findByText("status:signedIn expired:false");
    await act(() => t.session().signOut());
    const logouts = t.callsTo("POST /auth/logout");
    expect(logouts.map((c) => c.body)).toEqual([{ refresh_token: "r1" }, { refresh_token: "r2" }]);
    expect(screen.getByText("status:signedOut expired:false")).toBeOnTheScreen();
  });
});
