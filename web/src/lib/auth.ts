/**
 * Token storage and API client wiring.
 *
 * The access token lives in memory and in localStorage; the refresh token lives in
 * localStorage. This is a known trade-off (any XSS can read both): replace the refresh
 * token storage with an httpOnly, SameSite cookie set by the API when that lands.
 */
import { createApiClient, isApiError, type ApiClient, type TokenPair } from "@ams/shared";
import { storage } from "@/lib/storage";

const ACCESS_KEY = "ams.access_token";
const REFRESH_KEY = "ams.refresh_token";
const EXPIRES_KEY = "ams.access_expires_at";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires (informational). */
  expiresAt: number | null;
}

type Listener = (tokens: Tokens | null) => void;

export interface TokenStore {
  get(): Tokens | null;
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  isAuthenticated(): boolean;
  /** Stores a pair from login, accept-invite or refresh. */
  setPair(pair: Pick<TokenPair, "access_token" | "refresh_token" | "expires_in">): void;
  clear(): void;
  subscribe(listener: Listener): () => void;
}

export function createTokenStore(now: () => number = Date.now): TokenStore {
  const access = storage.get(ACCESS_KEY);
  const refresh = storage.get(REFRESH_KEY);
  const exp = storage.get(EXPIRES_KEY);
  let tokens: Tokens | null =
    refresh !== null
      ? { accessToken: access ?? "", refreshToken: refresh, expiresAt: exp !== null ? Number(exp) || null : null }
      : null;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l(tokens));

  return {
    get: () => tokens,
    getAccessToken: () => (tokens && tokens.accessToken !== "" ? tokens.accessToken : null),
    getRefreshToken: () => tokens?.refreshToken ?? null,
    isAuthenticated: () => tokens !== null,
    setPair(pair) {
      const expiresAt = typeof pair.expires_in === "number" ? now() + pair.expires_in * 1000 : null;
      tokens = { accessToken: pair.access_token, refreshToken: pair.refresh_token, expiresAt };
      storage.set(ACCESS_KEY, pair.access_token);
      storage.set(REFRESH_KEY, pair.refresh_token);
      storage.set(EXPIRES_KEY, expiresAt === null ? null : String(expiresAt));
      emit();
    },
    clear() {
      tokens = null;
      storage.set(ACCESS_KEY, null);
      storage.set(REFRESH_KEY, null);
      storage.set(EXPIRES_KEY, null);
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Exchanges the stored refresh token for a new pair (rotation) and stores it.
 * Resolves `false` when the server rejects the refresh token (400/401/403: sign out);
 * throws on transient failures (network, 5xx) so the caller keeps the session.
 */
export async function refreshTokens(client: ApiClient, store: TokenStore): Promise<boolean> {
  const refreshToken = store.getRefreshToken();
  if (!refreshToken) return false;
  try {
    const pair = await client.auth.refresh(refreshToken);
    store.setPair(pair);
    return true;
  } catch (e) {
    if (isApiError(e) && (e.status === 400 || e.status === 401 || e.status === 403)) return false;
    throw e;
  }
}

export interface AuthedClientOptions {
  baseUrl: string;
  store: TokenStore;
  fetch?: typeof fetch;
  /** Called after an unrecoverable 401 (tokens are already cleared). */
  onLogout?: () => void;
}

/**
 * `createApiClient` wired to the token store: `refresh()` calls `/auth/refresh` with the
 * stored refresh token and stores the rotated pair; `onAuthFailure` clears the tokens
 * and calls `onLogout`.
 */
export function createAuthedApiClient({ baseUrl, store, fetch: fetchImpl, onLogout }: AuthedClientOptions): ApiClient {
  const client: ApiClient = createApiClient({
    baseUrl,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    getAccessToken: () => store.getAccessToken(),
    refresh: () => refreshTokens(client, store),
    onAuthFailure() {
      if (store.isAuthenticated()) store.clear();
      onLogout?.();
    },
  });
  return client;
}
