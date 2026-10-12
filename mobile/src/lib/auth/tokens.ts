import type { TokenPair } from "@ams/shared";
import { STORAGE_KEYS, type KeyValueStorage } from "../storage";

/**
 * Access + refresh token holder. Tokens live in SecureStore and are mirrored in memory so
 * the API client can read them without a native round trip per request.
 */
export interface TokenStore {
  /** Reads persisted tokens into memory (call once at startup). */
  load(): Promise<void>;
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  hasSession(): boolean;
  set(pair: Pick<TokenPair, "access_token" | "refresh_token">): Promise<void>;
  clear(): Promise<void>;
}

export function createTokenStore(storage: KeyValueStorage): TokenStore {
  let access: string | null = null;
  let refresh: string | null = null;

  return {
    async load() {
      const [a, r] = await Promise.all([
        storage.getItem(STORAGE_KEYS.accessToken),
        storage.getItem(STORAGE_KEYS.refreshToken),
      ]);
      access = a;
      refresh = r;
    },
    getAccessToken: () => access,
    getRefreshToken: () => refresh,
    hasSession: () => refresh !== null || access !== null,
    async set(pair) {
      access = pair.access_token;
      refresh = pair.refresh_token;
      await Promise.all([
        storage.setItem(STORAGE_KEYS.accessToken, pair.access_token),
        storage.setItem(STORAGE_KEYS.refreshToken, pair.refresh_token),
      ]);
    },
    async clear() {
      access = null;
      refresh = null;
      await Promise.all([
        storage.removeItem(STORAGE_KEYS.accessToken),
        storage.removeItem(STORAGE_KEYS.refreshToken),
      ]);
    },
  };
}
