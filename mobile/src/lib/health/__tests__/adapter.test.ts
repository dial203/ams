import { ApiError, type ApiClient, type SdkTokenResponse } from "@ams/shared";
import * as stub from "../ow-sdk-stub";
import { createHealthAdapter, HEALTH_DATA_TYPES, normalizeOwHost, SYNC_DAYS_BACK } from "../adapter";
import { loadOpenWearablesSdk, type OpenWearablesSdk } from "../sdk";
import { HealthConnectError, HealthUnavailableError } from "../types";
import { memoryStorage, STORAGE_KEYS } from "../../storage";

const TOKEN: SdkTokenResponse = {
  access_token: "ow-access",
  refresh_token: "ow-refresh",
  expires_in: 3600,
  ow_base_url: "https://ow.example.org/",
  ow_user_id: "ow-user-1",
};

function fakeApi(token: () => Promise<SdkTokenResponse> = async () => TOKEN) {
  const wearableSdkToken = jest.fn((_orgId: string) => token());
  return { api: { self: { wearableSdkToken } } as unknown as Pick<ApiClient, "self">, wearableSdkToken };
}

/** A recording fake of the native SDK. */
function fakeSdk(options: { providers?: { id: string; displayName: string; isAvailable: boolean }[] } = {}) {
  const calls: string[] = [];
  const listeners: Record<string, ((payload: unknown) => void)[]> = {};
  let session = false;
  let syncing = false;
  let provider: string | null = null;
  const sdk = {
    configure: jest.fn((host: string) => calls.push(`configure ${host}`)),
    signIn: jest.fn(async (userId: string, access: string | null, refresh: string | null, apiKey: string | null) => {
      calls.push(`signIn ${userId} ${access} ${refresh} ${apiKey}`);
      session = true;
    }),
    signOut: jest.fn(async () => {
      calls.push("signOut");
      session = false;
    }),
    updateTokens: jest.fn((a: string, r: string | null) => calls.push(`updateTokens ${a} ${r}`)),
    restoreSession: jest.fn(() => null),
    isSessionValid: jest.fn(() => session),
    requestAuthorization: jest.fn(async (types: string[]) => {
      calls.push(`requestAuthorization ${types.length}`);
      return true;
    }),
    setSyncInterval: jest.fn(),
    startBackgroundSync: jest.fn(async (days: number | null) => {
      calls.push(`startBackgroundSync ${days}`);
      syncing = true;
      return true;
    }),
    stopBackgroundSync: jest.fn(async () => {
      calls.push("stopBackgroundSync");
      syncing = false;
    }),
    isSyncActive: jest.fn(() => syncing),
    getSyncStatus: jest.fn(() => ({
      hasResumableSession: false,
      sentCount: 12,
      completedTypes: 3,
      isFullExport: false,
      initialExportDone: true,
      isSyncing: false,
      createdAt: null,
    })),
    resumeSync: jest.fn(async () => false),
    resetAnchors: jest.fn(),
    getStoredCredentials: jest.fn(() => ({
      userId: session ? "ow-user-1" : null,
      accessToken: null,
      refreshToken: null,
      apiKey: null,
      host: null,
      customSyncUrl: null,
      isSyncActive: syncing,
      provider,
    })),
    getAvailableProviders: jest.fn(() => options.providers ?? [{ id: "apple", displayName: "Apple Health", isAvailable: true }]),
    setProvider: jest.fn((id: string) => {
      calls.push(`setProvider ${id}`);
      provider = id;
      return true;
    }),
    setLogLevel: jest.fn(),
    getLogLevel: jest.fn(() => 0),
    addListener: jest.fn((event: string, fn: (payload: unknown) => void) => {
      (listeners[event] ??= []).push(fn);
      return { remove: jest.fn() };
    }),
  };
  return {
    sdk: sdk as unknown as OpenWearablesSdk,
    raw: sdk,
    calls,
    emit: (event: string, payload: unknown) => listeners[event]?.forEach((fn) => fn(payload)),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("open-wearables stub", () => {
  it("is what `open-wearables` resolves to here, and reports itself unavailable", () => {
    expect(stub.isAvailable()).toBe(false);
    expect(stub.default.isSessionValid()).toBe(false);
    expect(() => stub.default.configure("https://ow.example.org")).toThrow(/development build/);
    const loaded = loadOpenWearablesSdk();
    expect(loaded).toEqual({ ok: false, reason: "not-installed" });
  });

  it("makes the adapter unavailable: status, connect and startSync", async () => {
    const { api, wearableSdkToken } = fakeApi();
    const adapter = createHealthAdapter({ api, platform: "ios", storage: memoryStorage() });
    expect(adapter.isAvailable()).toBe(false);
    expect(adapter.unavailableReason()).toBe("not-installed");
    expect(adapter.status()).toEqual({ state: "unavailable", reason: "not-installed" });
    expect(adapter.providers()).toEqual([]);
    await expect(adapter.connect("org-1")).rejects.toBeInstanceOf(HealthUnavailableError);
    await expect(adapter.startSync()).rejects.toBeInstanceOf(HealthUnavailableError);
    await expect(adapter.signOutLocal()).resolves.toBeUndefined();
    expect(wearableSdkToken).not.toHaveBeenCalled();
  });

  it("is unavailable off iOS/Android and when the native module is missing", () => {
    const { api } = fakeApi();
    expect(createHealthAdapter({ api, platform: "web" }).status()).toEqual({
      state: "unavailable",
      reason: "unsupported-platform",
    });
    const expoGo = createHealthAdapter({
      api,
      platform: "android",
      loadSdk: () => ({ ok: false, reason: "native-module-missing" }),
    });
    expect(expoGo.unavailableReason()).toBe("native-module-missing");
  });
});

describe("health adapter with the SDK", () => {
  it("connects: AMS sdk-token, configure, signIn, permissions, background sync", async () => {
    const { api, wearableSdkToken } = fakeApi();
    const fake = fakeSdk();
    const storage = memoryStorage();
    const adapter = createHealthAdapter({ api, platform: "ios", storage, loadSdk: () => ({ ok: true, sdk: fake.sdk }) });
    expect(adapter.status()).toEqual({ state: "disconnected", providers: [{ id: "apple", name: "Apple Health", available: true }] });

    await adapter.connect("org-1");

    expect(wearableSdkToken).toHaveBeenCalledWith("org-1");
    expect(fake.calls).toEqual([
      "configure https://ow.example.org",
      "signIn ow-user-1 ow-access ow-refresh null",
      `requestAuthorization ${HEALTH_DATA_TYPES.length}`,
      `startBackgroundSync ${SYNC_DAYS_BACK}`,
    ]);
    expect(fake.raw.requestAuthorization.mock.calls[0]![0]).toEqual(
      expect.arrayContaining(["steps", "heartRate", "restingHeartRate", "heartRateVariabilitySDNN", "sleep", "workout"]),
    );
    expect(storage.data.get(STORAGE_KEYS.owOrgId)).toBe("org-1");
    expect(adapter.status()).toMatchObject({ state: "connected", syncActive: true, sentCount: 12, authError: false });
  });

  it("picks Health Connect on Android, or the provider the athlete chose", async () => {
    const providers = [
      { id: "samsung", displayName: "Samsung Health", isAvailable: true },
      { id: "google", displayName: "Health Connect", isAvailable: true },
    ];
    const first = fakeSdk({ providers });
    const a = createHealthAdapter({ api: fakeApi().api, platform: "android", storage: memoryStorage(), loadSdk: () => ({ ok: true, sdk: first.sdk }) });
    await a.connect("org-1");
    expect(first.raw.setProvider).toHaveBeenCalledWith("google");

    const second = fakeSdk({ providers });
    const b = createHealthAdapter({ api: fakeApi().api, platform: "android", storage: memoryStorage(), loadSdk: () => ({ ok: true, sdk: second.sdk }) });
    await b.connect("org-1", { provider: "samsung" });
    expect(second.raw.setProvider).toHaveBeenCalledWith("samsung");
  });

  it("signs out again when no Android health store is installed", async () => {
    const fake = fakeSdk({ providers: [{ id: "google", displayName: "Health Connect", isAvailable: false }] });
    const adapter = createHealthAdapter({ api: fakeApi().api, platform: "android", storage: memoryStorage(), loadSdk: () => ({ ok: true, sdk: fake.sdk }) });
    await expect(adapter.connect("org-1")).rejects.toThrow(/Install Health Connect/);
    expect(fake.raw.signOut).toHaveBeenCalled();
    expect(fake.raw.startBackgroundSync).not.toHaveBeenCalled();
  });

  it("explains a 503 from sdk-token (Open Wearables not set up)", async () => {
    const { api } = fakeApi(async () => {
      throw new ApiError({ status: 503, detail: "Open Wearables app credentials are not configured" });
    });
    const fake = fakeSdk();
    const adapter = createHealthAdapter({ api, platform: "ios", storage: memoryStorage(), loadSdk: () => ({ ok: true, sdk: fake.sdk }) });
    const error = await adapter.connect("org-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HealthConnectError);
    expect((error as Error).message).toMatch(/hasn't been set up by your organization/);
    expect(fake.raw.signIn).not.toHaveBeenCalled();
  });

  it("refreshes SDK tokens from AMS on onAuthError, with a cooldown", async () => {
    let n = 0;
    const { api, wearableSdkToken } = fakeApi(async () => {
      n += 1;
      return { ...TOKEN, access_token: `ow-access-${n}`, refresh_token: `ow-refresh-${n}` };
    });
    const fake = fakeSdk();
    let now = 1_000_000;
    const adapter = createHealthAdapter({
      api,
      platform: "ios",
      storage: memoryStorage(),
      loadSdk: () => ({ ok: true, sdk: fake.sdk }),
      now: () => now,
    });
    await adapter.connect("org-1");
    const changes = jest.fn();
    adapter.subscribe(changes);

    fake.emit("onAuthError", { statusCode: 401, message: "expired" });
    await flush();
    expect(fake.raw.updateTokens).toHaveBeenLastCalledWith("ow-access-2", "ow-refresh-2");
    expect(adapter.status()).toMatchObject({ authError: false });

    // A second auth error right away means the fresh token was rejected too.
    fake.emit("onAuthError", { statusCode: 401, message: "expired" });
    await flush();
    expect(wearableSdkToken).toHaveBeenCalledTimes(2);
    expect(adapter.status()).toMatchObject({ authError: true });
    expect(changes).toHaveBeenCalled();

    now += 60_000;
    fake.emit("onAuthError", { statusCode: 401, message: "expired" });
    await flush();
    expect(fake.raw.updateTokens).toHaveBeenLastCalledWith("ow-access-3", "ow-refresh-3");
  });

  it("restores the connected org on launch so token refreshes use the right athlete", async () => {
    const { api, wearableSdkToken } = fakeApi();
    const fake = fakeSdk();
    const adapter = createHealthAdapter({
      api,
      platform: "ios",
      storage: memoryStorage({ [STORAGE_KEYS.owOrgId]: "org-9" }),
      loadSdk: () => ({ ok: true, sdk: fake.sdk }),
    });
    await adapter.restore();
    expect(adapter.connectedOrgId()).toBe("org-9");
    fake.emit("onAuthError", { statusCode: 401, message: "expired" });
    await flush();
    expect(wearableSdkToken).toHaveBeenCalledWith("org-9");
  });

  it("disconnects: revokes the OW connection with a fresh token, then stops and signs out", async () => {
    const { api } = fakeApi();
    const fake = fakeSdk();
    const owFetch = jest.fn(async (_url: string, _init: RequestInit) => ({ ok: false, status: 404 }) as Response);
    const adapter = createHealthAdapter({
      api,
      platform: "ios",
      storage: memoryStorage(),
      loadSdk: () => ({ ok: true, sdk: fake.sdk }),
      fetch: owFetch as unknown as typeof fetch,
    });
    await adapter.connect("org-1");
    await adapter.disconnect();
    expect(owFetch).toHaveBeenCalledWith("https://ow.example.org/api/v1/users/ow-user-1/connections/apple", {
      method: "DELETE",
      headers: { Authorization: "Bearer ow-access" },
    });
    expect(fake.calls.slice(-2)).toEqual(["stopBackgroundSync", "signOut"]);
    expect(adapter.status().state).toBe("disconnected");
    expect(adapter.connectedOrgId()).toBeNull();
  });

  it("keeps the session when Open Wearables refuses the disconnect", async () => {
    const fake = fakeSdk();
    const adapter = createHealthAdapter({
      api: fakeApi().api,
      platform: "ios",
      storage: memoryStorage(),
      loadSdk: () => ({ ok: true, sdk: fake.sdk }),
      fetch: (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch,
    });
    await adapter.connect("org-1");
    await expect(adapter.disconnect()).rejects.toThrow(/Couldn't disconnect/);
    expect(fake.raw.signOut).not.toHaveBeenCalled();
  });

  it("signOutLocal stops sync without calling Open Wearables", async () => {
    const fake = fakeSdk();
    const owFetch = jest.fn();
    const adapter = createHealthAdapter({
      api: fakeApi().api,
      platform: "ios",
      storage: memoryStorage(),
      loadSdk: () => ({ ok: true, sdk: fake.sdk }),
      fetch: owFetch as unknown as typeof fetch,
    });
    await adapter.connect("org-1");
    await adapter.signOutLocal();
    expect(owFetch).not.toHaveBeenCalled();
    expect(fake.raw.signOut).toHaveBeenCalled();
  });
});

describe("normalizeOwHost", () => {
  it("strips trailing slashes and an /api/v1 suffix", () => {
    expect(normalizeOwHost("https://ow.example.org/")).toBe("https://ow.example.org");
    expect(normalizeOwHost(" https://ow.example.org/api/v1/ ")).toBe("https://ow.example.org");
  });
});
