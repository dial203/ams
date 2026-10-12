import type { ApiClient } from "@ams/shared";
import { createContext, useContext } from "react";
import type { TokenStore } from "@/lib/auth";

export interface ApiContextValue {
  api: ApiClient;
  tokens: TokenStore;
}

export const ApiContext = createContext<ApiContextValue | null>(null);

export function useApiContext(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("ApiContext missing");
  return ctx;
}

export function useApi(): ApiClient {
  return useApiContext().api;
}
