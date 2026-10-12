import { createContext, useContext } from "react";
import { createApiClient, isApiError, type ApiClient } from "@ams/shared";
import { APP_VERSION } from "./config";
import type { TokenStore } from "./auth/tokens";

export interface AmsApiOptions {
  baseUrl: string;
  tokens: TokenStore;
  /** Called when the session cannot be recovered (refresh token rejected or missing). */
  onSessionExpired(): void;
  fetch?: typeof fetch;
}

/**
 * The shared API client wired to the token store:
 * - every request sends the in-memory access token;
 * - a 401 triggers one shared `POST /auth/refresh` with the stored refresh token (rotating:
 *   the new pair replaces the old one), then the request is retried;
 * - only an auth rejection of the refresh (400/401/403) ends the session. Any other failure
 *   (offline, server error) is rethrown, which the shared client passes to the caller
 *   without calling `onAuthFailure`, so offline athletes stay signed in.
 */
export function createAmsApi(options: AmsApiOptions): ApiClient {
  const client: ApiClient = createApiClient({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    headers: { "X-Client": `ams-mobile/${APP_VERSION}` },
    getAccessToken: () => options.tokens.getAccessToken(),
    async refresh() {
      const refreshToken = options.tokens.getRefreshToken();
      if (!refreshToken) return false;
      try {
        const pair = await client.auth.refresh(refreshToken);
        await options.tokens.set(pair);
        return true;
      } catch (error) {
        if (isApiError(error) && (error.status === 400 || error.status === 401 || error.status === 403)) return false;
        throw error;
      }
    },
    onAuthFailure: () => options.onSessionExpired(),
  });
  return client;
}

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used inside <ApiContext.Provider>");
  return api;
}
