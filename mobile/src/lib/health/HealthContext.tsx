import { createContext, useContext, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { HealthAdapter, HealthStatus } from "./types";

export const HealthContext = createContext<HealthAdapter | null>(null);

export function useHealthAdapter(): HealthAdapter {
  const adapter = useContext(HealthContext);
  if (!adapter) throw new Error("useHealthAdapter must be used inside <HealthContext.Provider>");
  return adapter;
}

export const HEALTH_STATUS_KEY = ["ams", "health", "status"] as const;

/** Health sync status from the SDK, refreshed after every adapter change and periodically. */
export function useHealthStatus() {
  const adapter = useHealthAdapter();
  const queryClient = useQueryClient();
  useEffect(
    () => adapter.subscribe(() => void queryClient.invalidateQueries({ queryKey: HEALTH_STATUS_KEY })),
    [adapter, queryClient],
  );
  return useQuery<HealthStatus>({
    queryKey: HEALTH_STATUS_KEY,
    queryFn: () => adapter.status(),
    networkMode: "always",
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.state === "connected" && data.syncing ? 5_000 : 60_000;
    },
  });
}
