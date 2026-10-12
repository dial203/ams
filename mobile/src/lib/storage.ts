import * as SecureStore from "expo-secure-store";

/** Minimal async key-value store. The app uses SecureStore (Keychain / Keystore) for all of it. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const secureStorage: KeyValueStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

/** In-memory storage for tests. */
export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

/** SecureStore keys may only contain alphanumerics, ".", "-" and "_". */
export const STORAGE_KEYS = {
  accessToken: "ams.access_token",
  refreshToken: "ams.refresh_token",
  orgId: "ams.org_id",
  pushToken: "ams.push_token",
  owHost: "ams.ow_host",
  owOrgId: "ams.ow_org_id",
} as const;
