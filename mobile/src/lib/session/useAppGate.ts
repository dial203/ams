import { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys, type Me, type Membership } from "@ams/shared";
import { useApi } from "../api";
import { athleteMemberships, resolveMembership, toActiveMembership, type ActiveMembership } from "./membership";
import { useSession } from "./SessionProvider";

/** Which part of the app the user may see. */
export type AppGate =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "accountError"; error: unknown; retry: () => void }
  | { kind: "noAthlete"; me: Me }
  | { kind: "selectOrg"; memberships: Membership[] }
  | { kind: "app"; membership: ActiveMembership; memberships: Membership[] };

export function useMeQuery(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.me(),
    queryFn: ({ signal }) => api.me.get({ signal }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useAppGate(): AppGate {
  const session = useSession();
  const me = useMeQuery(session.status === "signedIn");
  const { data, error, refetch } = me;
  const pending = me.isPending;

  return useMemo<AppGate>(() => {
    if (session.status === "loading") return { kind: "loading" };
    if (session.status === "signedOut") return { kind: "signedOut" };
    if (!data) {
      if (error) return { kind: "accountError", error, retry: () => void refetch() };
      if (pending) return { kind: "loading" };
      return { kind: "loading" };
    }
    const memberships = athleteMemberships(data);
    if (memberships.length === 0) return { kind: "noAthlete", me: data };
    const chosen = resolveMembership(memberships, session.storedOrgId);
    if (!chosen) return { kind: "selectOrg", memberships };
    return { kind: "app", membership: toActiveMembership(chosen), memberships };
  }, [session.status, session.storedOrgId, data, error, pending, refetch]);
}

/** The current gate, for screens that render it (org picker, account status). */
export const AppGateContext = createContext<AppGate>({ kind: "loading" });

export function useGate(): AppGate {
  return useContext(AppGateContext);
}
