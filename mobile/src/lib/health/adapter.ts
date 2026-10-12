import { Platform } from "react-native";
import { isApiError, type ApiClient } from "@ams/shared";
import { secureStorage, STORAGE_KEYS, type KeyValueStorage } from "../storage";
import { loadOpenWearablesSdk, type OpenWearablesSdk, type SdkLoadResult } from "./sdk";
import {
  HealthConnectError,
  HealthUnavailableError,
  type HealthAdapter,
  type HealthProviderInfo,
  type HealthStatus,
} from "./types";

/** Days of history uploaded on the first sync. */
export const SYNC_DAYS_BACK = 30;

/**
 * Health-store types AMS asks for: everything behind its wearable daily metrics (sleep,
 * HRV, resting HR, respiratory rate, activity, body) plus workouts. Values are the SDK's
 * `HealthDataType` ids.
 */
export const HEALTH_DATA_TYPES = [
  "steps",
  "distanceWalkingRunning",
  "activeEnergy",
  "heartRate",
  "restingHeartRate",
  "heartRateVariabilitySDNN",
  "respiratoryRate",
  "oxygenSaturation",
  "vo2Max",
  "sleep",
  "workout",
  "bodyMass",
  "bodyFatPercentage",
] as const;

/** SDK provider id -> Open Wearables provider slug (for the disconnect call). */
export const OW_PROVIDER_SLUGS: Record<string, string> = {
  apple: "apple",
  google: "health_connect",
  samsung: "samsung",
};

const PROVIDER_NAMES: Record<string, string> = {
  apple: "Apple Health",
  google: "Health Connect",
  samsung: "Samsung Health",
};

/** Android preference when the user has not picked one: Health Connect, then Samsung Health. */
const ANDROID_PROVIDER_ORDER = ["google", "samsung"];

/** Minimum time between two token refreshes triggered by `onAuthError`. */
const AUTH_REFRESH_COOLDOWN_MS = 30_000;

/** The SDK wants the Open Wearables host, without the `/api/v1` prefix. */
export function normalizeOwHost(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/v\d+$/, "");
}

export interface HealthAdapterDeps {
  api: Pick<ApiClient, "self">;
  /** Defaults to requiring `open-wearables` (the stub when it is not installed). */
  loadSdk?: () => SdkLoadResult;
  platform?: string;
  storage?: KeyValueStorage;
  fetch?: typeof fetch;
  now?: () => number;
}

export function createHealthAdapter(deps: HealthAdapterDeps): HealthAdapter {
  const platform = deps.platform ?? Platform.OS;
  const storage = deps.storage ?? secureStorage;
  const now = deps.now ?? Date.now;
  const doFetch = (input: string, init: RequestInit) => (deps.fetch ? deps.fetch(input, init) : fetch(input, init));

  let loaded: SdkLoadResult | null = null;
  let initialised = false;
  let authSubscription: { remove(): void } | null = null;
  /** Org whose athlete the SDK session belongs to (tokens are minted per athlete). */
  let connectedOrgId: string | null = null;
  let authError = false;
  let refreshing = false;
  let lastRefreshAt = -Infinity;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const l of Array.from(listeners)) l();
  };

  function load(): SdkLoadResult {
    if (!loaded) {
      loaded =
        platform === "ios" || platform === "android"
          ? (deps.loadSdk ?? loadOpenWearablesSdk)()
          : { ok: false, reason: "unsupported-platform" };
    }
    return loaded;
  }

  async function refreshTokens(sdk: OpenWearablesSdk): Promise<void> {
    if (refreshing) return;
    if (!connectedOrgId || now() - lastRefreshAt < AUTH_REFRESH_COOLDOWN_MS) {
      authError = true;
      notify();
      return;
    }
    refreshing = true;
    lastRefreshAt = now();
    try {
      const token = await deps.api.self.wearableSdkToken(connectedOrgId);
      sdk.updateTokens(token.access_token, token.refresh_token);
      authError = false;
    } catch {
      authError = true;
    } finally {
      refreshing = false;
      notify();
    }
  }

  /** Once per launch: re-apply the stored host and listen for auth errors. */
  function init(sdk: OpenWearablesSdk): void {
    if (initialised) return;
    initialised = true;
    try {
      const host = sdk.getStoredCredentials().host;
      if (host) sdk.configure(host);
    } catch {
      // A fresh install has no stored session.
    }
    authSubscription = sdk.addListener("onAuthError", () => {
      void refreshTokens(sdk);
    });
  }

  function requireSdk(): OpenWearablesSdk {
    const result = load();
    if (!result.ok) throw new HealthUnavailableError(result.reason);
    init(result.sdk);
    return result.sdk;
  }

  function providerList(sdk: OpenWearablesSdk): HealthProviderInfo[] {
    try {
      return sdk.getAvailableProviders().map((p) => ({
        id: p.id,
        name: PROVIDER_NAMES[p.id] ?? p.displayName,
        available: p.isAvailable,
      }));
    } catch {
      return platform === "ios" ? [{ id: "apple", name: PROVIDER_NAMES.apple!, available: true }] : [];
    }
  }

  function chooseAndroidProvider(sdk: OpenWearablesSdk, preferred?: string): string | null {
    const available = providerList(sdk).filter((p) => p.available);
    if (preferred) return available.some((p) => p.id === preferred) ? preferred : null;
    for (const id of ANDROID_PROVIDER_ORDER) if (available.some((p) => p.id === id)) return id;
    return available[0]?.id ?? null;
  }

  async function setConnectedOrg(orgId: string | null): Promise<void> {
    connectedOrgId = orgId;
    try {
      if (orgId) await storage.setItem(STORAGE_KEYS.owOrgId, orgId);
      else await storage.removeItem(STORAGE_KEYS.owOrgId);
    } catch {
      // Not fatal: the session still works until the next auth error.
    }
  }

  return {
    isAvailable: () => load().ok,

    unavailableReason() {
      const result = load();
      return result.ok ? null : result.reason;
    },

    providers() {
      const result = load();
      return result.ok ? providerList(result.sdk) : [];
    },

    async restore() {
      try {
        connectedOrgId = await storage.getItem(STORAGE_KEYS.owOrgId);
      } catch {
        connectedOrgId = null;
      }
      const result = load();
      if (result.ok) init(result.sdk);
    },

    async connect(orgId, options = {}) {
      const sdk = requireSdk();
      let token;
      try {
        token = await deps.api.self.wearableSdkToken(orgId);
      } catch (error) {
        if (isApiError(error) && error.status === 503) {
          throw new HealthConnectError("Health sync hasn't been set up by your organization yet. Ask your staff.");
        }
        throw error;
      }
      const host = normalizeOwHost(token.ow_base_url);
      if (!host) throw new HealthConnectError("The server did not return an Open Wearables address.");

      sdk.configure(host);
      await sdk.signIn(token.ow_user_id, token.access_token, token.refresh_token, null);
      await setConnectedOrg(orgId);

      if (platform === "android") {
        const provider = chooseAndroidProvider(sdk, options.provider);
        if (!provider || !sdk.setProvider(provider)) {
          await sdk.signOut().catch(() => undefined);
          await setConnectedOrg(null);
          notify();
          throw new HealthConnectError("Install Health Connect (or Samsung Health) to sync health data.");
        }
      }

      // On iOS the result does not reveal what was granted (HealthKit hides read access).
      await sdk.requestAuthorization([...HEALTH_DATA_TYPES] as unknown as Parameters<OpenWearablesSdk["requestAuthorization"]>[0]);
      const started = await sdk.startBackgroundSync(SYNC_DAYS_BACK);
      authError = false;
      notify();
      if (!started) {
        throw new HealthConnectError("Couldn't start health sync. Check that AMS may read your health data in Settings.");
      }
    },

    async disconnect(orgId) {
      const sdk = requireSdk();
      const org = orgId ?? connectedOrgId;
      if (org && sdk.isSessionValid()) {
        // Report the disconnect to Open Wearables before clearing the local session; signOut()
        // alone makes no network call and would leave the connection looking active.
        const token = await deps.api.self.wearableSdkToken(org);
        const host = normalizeOwHost(token.ow_base_url);
        const providerId = sdk.getStoredCredentials().provider ?? (platform === "ios" ? "apple" : "google");
        const slug = OW_PROVIDER_SLUGS[providerId] ?? providerId;
        const res = await doFetch(
          `${host}/api/v1/users/${encodeURIComponent(token.ow_user_id)}/connections/${encodeURIComponent(slug)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${token.access_token}` } },
        );
        if (!res.ok && res.status !== 404) {
          throw new HealthConnectError(`Couldn't disconnect (error ${res.status}). Please try again.`);
        }
      }
      await sdk.stopBackgroundSync();
      await sdk.signOut();
      await setConnectedOrg(null);
      authError = false;
      notify();
    },

    async signOutLocal() {
      const result = load();
      if (!result.ok) return;
      try {
        init(result.sdk);
        if (result.sdk.isSessionValid()) {
          await result.sdk.stopBackgroundSync();
          await result.sdk.signOut();
        }
      } catch {
        // Logging out must not fail because of the health SDK.
      }
      await setConnectedOrg(null);
      authError = false;
      notify();
    },

    status(): HealthStatus {
      const result = load();
      if (!result.ok) return { state: "unavailable", reason: result.reason };
      const sdk = result.sdk;
      try {
        init(sdk);
        if (!sdk.isSessionValid()) return { state: "disconnected", providers: providerList(sdk) };
        const sync = sdk.getSyncStatus();
        return {
          state: "connected",
          syncActive: sdk.isSyncActive(),
          syncing: sync.isSyncing,
          initialExportDone: sync.initialExportDone,
          sentCount: sync.sentCount,
          provider: sdk.getStoredCredentials().provider,
          authError,
        };
      } catch {
        return { state: "unavailable", reason: "native-module-missing" };
      }
    },

    async startSync() {
      const sdk = requireSdk();
      const started = await sdk.startBackgroundSync(SYNC_DAYS_BACK);
      notify();
      return started;
    },

    connectedOrgId: () => connectedOrgId,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      authSubscription?.remove();
      authSubscription = null;
      initialised = false;
      listeners.clear();
    },
  };
}
