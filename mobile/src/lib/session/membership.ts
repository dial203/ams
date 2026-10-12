import { createContext, useContext } from "react";
import { terminology, type Me, type Membership, type Organization, type OrgRole, type Terminology } from "@ams/shared";

/** The org the app is working in and the caller's athlete record there. */
export interface ActiveMembership {
  orgId: string;
  athleteId: string;
  org: Organization;
  role: OrgRole;
  terminology: Terminology;
}

/** Memberships that carry an athlete record (the `/orgs/{org}/me/*` routes need one). */
export function athleteMemberships(me: Me | null | undefined): Membership[] {
  if (!me) return [];
  return me.memberships
    .filter((m) => m.athlete_id !== null && m.athlete_id !== "")
    .slice()
    .sort((a, b) => a.org.name.localeCompare(b.org.name));
}

/** One membership is used directly; with several, the remembered choice if it is still valid. */
export function resolveMembership(memberships: Membership[], storedOrgId: string | null): Membership | null {
  if (memberships.length === 1) return memberships[0]!;
  if (storedOrgId) return memberships.find((m) => m.org.id === storedOrgId) ?? null;
  return null;
}

export function toActiveMembership(m: Membership): ActiveMembership {
  return {
    orgId: m.org.id,
    athleteId: m.athlete_id!,
    org: m.org,
    role: m.role,
    terminology: terminology(m.org),
  };
}

export const ActiveMembershipContext = createContext<ActiveMembership | null>(null);

export function useActiveMembership(): ActiveMembership {
  const value = useContext(ActiveMembershipContext);
  if (!value) throw new Error("useActiveMembership must be used inside the signed-in app");
  return value;
}
