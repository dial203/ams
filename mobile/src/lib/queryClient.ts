import { AppState, Platform, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { isApiError } from "@ams/shared";
import { isNetworkError } from "./errors";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Retry network failures and 5xx twice; never retry 4xx (they will not change). */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error)) return error.status >= 500 && failureCount < 2;
  return isNetworkError(error) && failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        // Keep data around so it can be shown while offline.
        gcTime: DAY_MS,
      },
      mutations: {
        // Fail fast when offline so the form can offer a retry instead of a silently paused submit.
        networkMode: "always",
        retry: false,
      },
    },
  });
}

/**
 * Wires TanStack Query to React Native: refetch when the app returns to the foreground,
 * and pause queries (showing cached data) while the device has no network. Only
 * `isConnected` is used: a phone on a LAN without internet can still reach a dev API.
 */
export function setupQueryManagers(): () => void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    }),
  );
  const onAppStateChange = (status: AppStateStatus) => {
    if (Platform.OS !== "web") focusManager.setFocused(status === "active");
  };
  const subscription = AppState.addEventListener("change", onAppStateChange);
  return () => {
    // Restores the default listener and unsubscribes NetInfo.
    onlineManager.setEventListener(() => undefined);
    subscription.remove();
  };
}
