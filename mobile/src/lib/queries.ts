import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { addDays, queryKeys, todayInTimeZone, type SelfSubmissionListParams } from "@ams/shared";
import { useApi } from "./api";
import { isWearablesNotConfigured } from "./errors";
import { pickTimeZone } from "./format";
import { shouldRetry } from "./queryClient";
import { useActiveMembership } from "./session/membership";

/** Current time, refreshed every `intervalMs` and whenever the app returns to the foreground. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") setNow(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [intervalMs]);
  return now;
}

export function useSelfAthlete() {
  const api = useApi();
  const { orgId } = useActiveMembership();
  return useQuery({
    queryKey: queryKeys.self.athlete(orgId),
    queryFn: ({ signal }) => api.self.athlete(orgId, { signal }),
    staleTime: 5 * 60_000,
  });
}

/**
 * The athlete's time zone (athlete setting, else org), the current time and today's date in
 * that zone. Re-renders every minute so "today" rolls over at midnight.
 */
export function useAthleteDay(): { timeZone: string; today: string; now: number } {
  const { org } = useActiveMembership();
  const athlete = useSelfAthlete();
  const now = useNow();
  const timeZone = pickTimeZone(athlete.data?.timezone, org.timezone);
  return { timeZone, today: todayInTimeZone(timeZone, now), now };
}

export function useTodayForms(date: string) {
  const api = useApi();
  const { orgId } = useActiveMembership();
  return useQuery({
    queryKey: queryKeys.self.forms(orgId, { date }),
    queryFn: ({ signal }) => api.self.forms(orgId, { date }, { signal }),
  });
}

/** Athlete-visible metrics over the four weeks ending `today`. */
export function useSelfMetrics(today: string, days = 28) {
  const api = useApi();
  const { orgId } = useActiveMembership();
  const params = { start: addDays(today, -(days - 1)), end: today };
  return useQuery({
    queryKey: queryKeys.self.metrics(orgId, params),
    queryFn: ({ signal }) => api.self.metrics(orgId, params, { signal }),
  });
}

export function useSelfSubmissions(params: SelfSubmissionListParams) {
  const api = useApi();
  const { orgId } = useActiveMembership();
  return useQuery({
    queryKey: queryKeys.self.submissions(orgId, params),
    queryFn: ({ signal }) => api.self.submissions(orgId, params, { signal }),
  });
}

/** A 503 from the wearable endpoints means "not configured", which retrying won't change. */
function retryUnlessNotConfigured(failureCount: number, error: unknown): boolean {
  return !isWearablesNotConfigured(error) && shouldRetry(failureCount, error);
}

export function useWearableStatus() {
  const api = useApi();
  const { orgId } = useActiveMembership();
  return useQuery({
    queryKey: queryKeys.self.wearables(orgId),
    queryFn: ({ signal }) => api.self.wearables(orgId, { signal }),
    retry: retryUnlessNotConfigured,
  });
}

export function useWearableProviders() {
  const api = useApi();
  const { orgId } = useActiveMembership();
  return useQuery({
    queryKey: queryKeys.self.wearableProviders(orgId),
    queryFn: ({ signal }) => api.self.wearableProviders(orgId, { signal }),
    staleTime: 10 * 60_000,
    retry: retryUnlessNotConfigured,
  });
}
