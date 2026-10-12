import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createApiClient, type ApiClient } from "@ams/shared";
import { ApiContext } from "../lib/api";
import { createHealthAdapter, type HealthAdapter } from "../lib/health";
import { HealthContext } from "../lib/health/HealthContext";
import { StorageContext } from "../lib/services";
import { ActiveMembershipContext, type ActiveMembership } from "../lib/session/membership";
import { SessionContext, type SessionContextValue } from "../lib/session/SessionProvider";
import { AppGateContext, type AppGate } from "../lib/session/useAppGate";
import { memoryStorage } from "../lib/storage";
import { createFetchMock, type MockHandler } from "./fetchMock";
import { activeMembership, membership } from "./fixtures";

export const TEST_BASE_URL = "https://ams.test/api/v1";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, networkMode: "always" },
    },
  });
}

export function createTestApi(fetchFn: typeof fetch): ApiClient {
  return createApiClient({ baseUrl: TEST_BASE_URL, fetch: fetchFn, getAccessToken: () => "access-token" });
}

export function mockSession(overrides: Partial<SessionContextValue> = {}): SessionContextValue {
  return {
    status: "signedIn",
    expired: false,
    storedOrgId: null,
    signIn: jest.fn(async () => undefined),
    acceptInvite: jest.fn(async () => undefined),
    signOut: jest.fn(async () => undefined),
    selectOrg: jest.fn(async () => undefined),
    clearOrg: jest.fn(async () => undefined),
    ...overrides,
  };
}

export interface RenderAppOptions {
  routes?: Record<string, MockHandler>;
  membership?: ActiveMembership | null;
  session?: Partial<SessionContextValue>;
  gate?: AppGate;
  health?: (api: ApiClient) => HealthAdapter;
}

/** Renders `ui` inside the app's providers, backed by the real API client and a fetch double. */
export async function renderApp(ui: ReactElement, options: RenderAppOptions = {}) {
  const fetchMock = createFetchMock(options.routes ?? {});
  const api = createTestApi(fetchMock.fetch);
  const queryClient = createTestQueryClient();
  const storage = memoryStorage();
  const health = options.health ? options.health(api) : createHealthAdapter({ api, platform: "ios", storage });
  const session = mockSession(options.session);
  const active = options.membership === undefined ? activeMembership : options.membership;
  const gate: AppGate =
    options.gate ?? (active ? { kind: "app", membership: active, memberships: [membership] } : { kind: "signedOut" });

  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiContext.Provider value={api}>
          <StorageContext.Provider value={storage}>
            <HealthContext.Provider value={health}>
              <SessionContext.Provider value={session}>
                <AppGateContext.Provider value={gate}>
                  <ActiveMembershipContext.Provider value={active}>{children}</ActiveMembershipContext.Provider>
                </AppGateContext.Provider>
              </SessionContext.Provider>
            </HealthContext.Provider>
          </StorageContext.Provider>
        </ApiContext.Provider>
      </QueryClientProvider>
    );
  }

  const result = await render(ui, { wrapper: Providers });
  return { ...result, ...fetchMock, api, queryClient, storage, health, session };
}
