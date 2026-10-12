import {
  queryKeys,
  terminology,
  todayInTimeZone,
  isValidTimeZone,
  type Me,
  type Membership,
  type Organization,
  type OrgRole,
  type Terminology,
} from "@ams/shared";
import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useApi } from "@/lib/api-context";
import { storage } from "@/lib/storage";

const ORG_KEY = "ams.org_id";
const groupKey = (orgId: string) => `ams.group.${orgId}`;

export interface OrgContextValue {
  me: Me;
  membership: Membership;
  org: Organization;
  orgId: string;
  role: OrgRole;
  /** owner or admin */
  isAdmin: boolean;
  terms: Terminology;
  timezone: string;
  /** Today in the org time zone. */
  today: string;
  /** Global group filter (persists per org across pages and reloads). */
  groupId: string | null;
  setGroupId(groupId: string | null): void;
  switchOrg(orgId: string): void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function rememberedOrgId(): string | null {
  return storage.get(ORG_KEY);
}

export function rememberOrgId(orgId: string): void {
  storage.set(ORG_KEY, orgId);
}

/** The membership to start in: the remembered org if still valid, else the only one. */
export function pickMembership(me: Me, remembered: string | null = rememberedOrgId()): Membership | null {
  if (me.memberships.length === 0) return null;
  const found = remembered ? me.memberships.find((m) => m.org.id === remembered) : undefined;
  if (found) return found;
  return me.memberships.length === 1 ? me.memberships[0]! : null;
}

export function safeToday(timezone: string): string {
  return todayInTimeZone(isValidTimeZone(timezone) ? timezone : "UTC");
}

export function OrgProvider({
  me,
  membership,
  onSwitchOrg,
  children,
}: {
  me: Me;
  membership: Membership;
  onSwitchOrg(orgId: string): void;
  children: ReactNode;
}) {
  const api = useApi();
  const orgId = membership.org.id;
  const orgQuery = useQuery({
    queryKey: queryKeys.orgs.detail(orgId),
    queryFn: ({ signal }) => api.orgs.get(orgId, { signal }),
    initialData: membership.org,
    staleTime: 60_000,
  });
  const org = orgQuery.data ?? membership.org;

  const [groupState, setGroupState] = useState<{ orgId: string; groupId: string | null }>(() => ({
    orgId,
    groupId: storage.get(groupKey(orgId)),
  }));
  const groupId = groupState.orgId === orgId ? groupState.groupId : storage.get(groupKey(orgId));

  const setGroupId = useCallback(
    (id: string | null) => {
      storage.set(groupKey(orgId), id);
      setGroupState({ orgId, groupId: id });
    },
    [orgId],
  );

  const value = useMemo<OrgContextValue>(() => {
    const timezone = org.timezone || "UTC";
    return {
      me,
      membership,
      org,
      orgId,
      role: membership.role,
      isAdmin: membership.role === "owner" || membership.role === "admin",
      terms: terminology(org),
      timezone,
      today: safeToday(timezone),
      groupId,
      setGroupId,
      switchOrg: onSwitchOrg,
    };
  }, [me, membership, org, orgId, groupId, setGroupId, onSwitchOrg]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used inside OrgProvider");
  return ctx;
}

/** For tests and stories: provide a fixed org context. */
export const OrgContextProvider = OrgContext.Provider;
