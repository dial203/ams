import { createContext, useContext } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@ams/shared";
import { createAmsApi } from "./api";
import { createTokenStore, type TokenStore } from "./auth/tokens";
import { API_URL } from "./config";
import { createHealthAdapter, type HealthAdapter } from "./health";
import { createQueryClient } from "./queryClient";
import { createSignal, type Signal } from "./signal";
import { secureStorage, type KeyValueStorage } from "./storage";

/** Long-lived singletons the app is built from (created once in the root layout). */
export interface AppServices {
  storage: KeyValueStorage;
  tokens: TokenStore;
  sessionExpired: Signal;
  api: ApiClient;
  queryClient: QueryClient;
  health: HealthAdapter;
}

export function createAppServices(): AppServices {
  const storage = secureStorage;
  const tokens = createTokenStore(storage);
  const sessionExpired = createSignal();
  const api = createAmsApi({ baseUrl: API_URL, tokens, onSessionExpired: () => sessionExpired.emit() });
  const queryClient = createQueryClient();
  const health = createHealthAdapter({ api, storage });
  return { storage, tokens, sessionExpired, api, queryClient, health };
}

export const StorageContext = createContext<KeyValueStorage>(secureStorage);

export function useStorage(): KeyValueStorage {
  return useContext(StorageContext);
}
