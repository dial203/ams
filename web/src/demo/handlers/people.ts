/** Organization, members, invitations, groups, staff assignments and athletes. */
import {
  ACCESS_ROLES,
  GROUP_KINDS,
  ORG_ROLES,
  type AccessRole,
  type Athlete,
  type Group,
  type GroupKind,
  type Invitation,
  type OrgRole,
  type StaffAssignment,
  type UUID,
} from "@ams/shared";
import { isFixtureError } from "../fixture";
import { fail, has, invalidBody, json, noContent, paginate, replay, requiredString } from "../http";
import { route, type Ctx, type RouteDef } from "../router";
import { clone, newId, nowIso, type DemoStore } from "../store";

const ORG = "/orgs/:org";
const PII_FIELDS = ["first_name", "last_name", "preferred_name", "email", "date_of_birth"] as const;

export function displayName(a: Pick<Athlete, "first_name" | "last_name" | "preferred_name" | "code" | "masked">): string {
  if (a.masked) return a.code;
  return `${a.preferred_name || a.first_name || ""} ${a.last_name ?? ""}`.trim();
}

function pageUrl(): string {
  const loc = globalThis.location as Location | undefined;
  return loc ? `${loc.origin}${loc.pathname}${loc.search}` : "https://demo.invalid/";
}

function newInvitation(store: DemoStore, email: string, role: OrgRole, athleteId: UUID | null): Invitation {
  const token = `demo-${newId().replace(/-/g, "")}`;
  const expires = new Date(Date.now() + 7 * 86400_000);
  const inv: Invitation = {
    id: newId(),
    email: email.trim().toLowerCase(),
    role,
    athlete_id: athleteId,
    expires_at: nowIso(expires),
    accepted_at: null,
    invite_url: `${pageUrl()}#/accept-invite?token=${token}`,
  };
  replay(store.invitations).unshift(inv);
  return inv;
}

/** The invitation with this token in the store, if any (for the public invite page). */
export function findInvitation(store: DemoStore, token: string): Invitation | undefined {
  const list = Array.isArray(store.invitations) ? store.invitations : [];
  return list.find((i) => i.invite_url.endsWith(`token=${token}`));
}

function checkEmail(body: Record<string, unknown>, key: string): string {
  const email = requiredString(body, key);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
    throw invalidBody(key, "value is not a valid email address: An email address must have an @-sign.");
  }
  return email;
}

function ownerCount(store: DemoStore): number {
  return store.memberList().filter((m) => m.role === "owner").length;
}

function member(store: DemoStore, userId: UUID) {
  const m = store.memberList().find((x) => x.user.id === userId);
  if (!m) throw fail(404, "member not found");
  return m;
}

function syncMemberAssignments(store: DemoStore): void {
  const staff = store.staff;
  if (!Array.isArray(store.members) || isFixtureError(staff)) return;
  const all = Object.values(staff).flatMap((list) => (Array.isArray(list) ? list : []));
  for (const m of store.members) m.assignments = all.filter((a) => a.user_id === m.user.id);
}

function nextCode(store: DemoStore): string {
  let max = 0;
  for (const a of store.athleteList()) {
    const m = /^A-(\d+)$/.exec(a.code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `A-${String(max + 1).padStart(4, "0")}`;
}

function codeTaken(store: DemoStore, code: string, exclude?: UUID): boolean {
  return store.athleteList().some((a) => a.code.toLowerCase() === code.toLowerCase() && a.id !== exclude);
}

function listAthletes({ req, store }: Ctx) {
  const q = req.query;
  const status = q.get("status");
  let items = store.athleteList().filter((a) => (status ? a.status === status : a.status !== "archived"));
  const groupId = q.get("group_id");
  if (groupId) {
    const ids = store.athleteIdsInGroup(groupId);
    items = items.filter((a) => ids.has(a.id));
  }
  const text = (q.get("q") ?? "").trim().toLowerCase();
  if (text) {
    items = items.filter((a) => {
      if (a.code.toLowerCase().includes(text)) return true;
      if (a.masked) return false;
      const parts = [
        a.first_name,
        a.last_name,
        a.preferred_name,
        a.email,
        `${a.first_name ?? ""} ${a.last_name ?? ""}`,
        `${a.preferred_name ?? ""} ${a.last_name ?? ""}`,
      ];
      return parts.some((p) => p && p.toLowerCase().includes(text));
    });
  }
  items = [...items].sort((a, b) => a.code.localeCompare(b.code));
  return json(paginate(items, q));
}

function createAthlete({ store, body: getBody }: Ctx) {
  const body = getBody();
  const first = requiredString(body, "first_name");
  const last = requiredString(body, "last_name");
  const groupIds = Array.isArray(body.group_ids) ? [...new Set(body.group_ids.map(String))] : [];
  for (const gid of groupIds) store.group(gid, `group ${gid} not found`);
  if (!store.isAdmin && (store.isAthlete || groupIds.length === 0 || !groupIds.every((g) => store.canWriteGroup(g)))) {
    throw fail(403, "admin, or staff with write on every listed group");
  }
  const code = typeof body.code === "string" && body.code.trim() ? body.code.trim() : nextCode(store);
  if (codeTaken(store, code)) throw fail(409, `athlete code '${code}' already exists`);
  const identifiable =
    store.isAdmin || groupIds.some((g) => (store.access.identifiable_group_ids ?? []).includes(g));
  const str = (k: string) => (typeof body[k] === "string" && (body[k] as string).trim() ? (body[k] as string) : null);
  const athlete: Athlete = {
    id: newId(),
    org_id: store.orgId,
    code,
    first_name: identifiable ? first : null,
    last_name: identifiable ? last : null,
    preferred_name: identifiable ? str("preferred_name") : null,
    email: identifiable ? (str("email")?.toLowerCase() ?? null) : null,
    date_of_birth: identifiable ? str("date_of_birth") : null,
    display_name: "",
    masked: !identifiable,
    sex: (str("sex") as Athlete["sex"]) ?? null,
    position: str("position"),
    timezone: str("timezone"),
    status: "active",
    attributes: (typeof body.attributes === "object" && body.attributes !== null ? body.attributes : {}) as Record<string, unknown>,
    group_ids: groupIds,
    user_id: null,
    ow_user_id: null,
    created_at: nowIso(),
  };
  athlete.display_name = displayName(athlete);
  replay(store.athletes).push(athlete);
  if (!store.isAdmin) {
    store.access.athletes[athlete.id] = {
      identifiable,
      write: true,
      read: [...store.access.readable_sensitivities],
      write_forms: [...store.access.writable_sensitivities],
    };
  }
  return json(athlete, 201);
}

function updateAthlete({ store, params, body: getBody }: Ctx) {
  const athlete = store.athlete(params.id!);
  const rights = store.rights(athlete.id);
  if (!rights?.write) throw fail(403, "write access to the athlete required");
  const body = getBody();
  if (!rights.identifiable && PII_FIELDS.some((k) => has(body, k))) throw fail(403, "identifiable fields are masked for you");
  for (const key of ["first_name", "last_name", "status", "code", "attributes"]) {
    if (has(body, key) && body[key] === null) throw fail(400, `${key} cannot be null`);
  }
  if (body.status === "archived" && !store.isAdmin) throw fail(403, "only admins archive athletes");
  if (typeof body.code === "string" && codeTaken(store, body.code, athlete.id)) {
    throw fail(409, `athlete code '${body.code}' already exists`);
  }
  if (Array.isArray(body.group_ids)) {
    const wanted = [...new Set(body.group_ids.map(String))];
    for (const gid of wanted) store.group(gid, `group ${gid} not found`);
    const changed = [...wanted.filter((g) => !athlete.group_ids.includes(g)), ...athlete.group_ids.filter((g) => !wanted.includes(g))];
    if (!changed.every((g) => store.canWriteGroup(g))) throw fail(403, "write access to the group required");
    athlete.group_ids = wanted;
  }
  const editable = ["code", ...PII_FIELDS, "sex", "position", "timezone", "status", "attributes"] as const;
  const target = athlete as unknown as Record<string, unknown>;
  for (const key of editable) {
    if (!has(body, key)) continue;
    const v = body[key];
    target[key] = key === "email" && typeof v === "string" ? v.toLowerCase() : v === "" && key !== "code" ? null : v;
  }
  athlete.display_name = displayName(athlete);
  return json(athlete);
}

function inviteAthlete({ store, params, body: getBody }: Ctx) {
  const athlete = store.athlete(params.id!);
  const rights = store.rights(athlete.id);
  if (!(store.isAdmin || (!store.isAthlete && rights?.write))) throw fail(403, "write access to the athlete required");
  if (athlete.user_id) throw fail(409, "athlete already has a login");
  const body = getBody();
  const given = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
  if (!given && !rights?.identifiable) throw fail(403, "athlete details are masked for you; provide an email");
  const email = given ?? athlete.email;
  if (!email) throw fail(400, "athlete has no email; provide one");
  return json(newInvitation(store, email, "athlete", athlete.id), 201);
}

function staffMap(store: DemoStore): Record<UUID, StaffAssignment[]> {
  const staff = replay(store.staff);
  return staff as Record<UUID, StaffAssignment[]>;
}

export const peopleRoutes: RouteDef[] = [
  // ---------------------------------------------------------------- organization
  route("GET", ORG, ({ store }) => json(store.org)),
  route("PATCH", ORG, ({ store, body: getBody }) => {
    store.requireAdmin();
    const body = getBody();
    const org = store.org;
    if (typeof body.name === "string" && body.name.trim()) org.name = body.name;
    if (typeof body.timezone === "string" && body.timezone) org.timezone = body.timezone;
    const settings = body.settings as Record<string, unknown> | null | undefined;
    if (settings && typeof settings === "object") {
      if (settings.terminology && typeof settings.terminology === "object") {
        const t = settings.terminology as Record<string, unknown>;
        for (const k of ["athlete", "athletes", "group", "groups"] as const) {
          if (typeof t[k] === "string" && (t[k] as string).trim()) org.settings.terminology[k] = t[k] as string;
        }
      }
      if (Array.isArray(settings.readiness_metrics)) {
        org.settings.readiness_metrics = [...new Set(settings.readiness_metrics.map(String))];
      }
    }
    for (const m of store.fixture.me.memberships) if (m.org.id === org.id) m.org = clone(org);
    return json(org);
  }),

  // ---------------------------------------------------------------- members
  route("GET", `${ORG}/members`, ({ store }) => {
    store.requireStaff();
    return json(replay(store.members));
  }),
  route("PATCH", `${ORG}/members/:user`, ({ store, params, body: getBody }) => {
    store.requireAdmin();
    const m = member(store, params.user!);
    const role = getBody().role as OrgRole;
    if (!ORG_ROLES.includes(role)) throw invalidBody("role", "Input should be 'owner', 'admin', 'staff' or 'athlete'", "enum");
    if ((m.role === "owner" || role === "owner") && !store.access.is_owner && m.role !== role) {
      throw fail(403, "only an owner can grant or revoke the owner role");
    }
    if (m.role === "owner" && role !== "owner" && ownerCount(store) <= 1) throw fail(409, "cannot demote the last owner");
    if (role === "athlete" && !m.athlete_id) throw fail(400, "the athlete role needs a linked athlete record");
    m.role = role;
    if (role === "athlete") {
      const staff = store.staff;
      if (!isFixtureError(staff)) {
        for (const [gid, list] of Object.entries(staff)) {
          if (Array.isArray(list)) staff[gid] = list.filter((a) => a.user_id !== m.user.id);
        }
      }
      m.assignments = [];
    }
    return json(m);
  }),
  route("DELETE", `${ORG}/members/:user`, ({ store, params }) => {
    store.requireAdmin();
    const m = member(store, params.user!);
    if (m.role === "owner") {
      if (!store.access.is_owner) throw fail(403, "only an owner can remove an owner");
      if (ownerCount(store) <= 1) throw fail(409, "cannot remove the last owner");
    }
    store.members = store.memberList().filter((x) => x !== m);
    const staff = store.staff;
    if (!isFixtureError(staff)) {
      for (const [gid, list] of Object.entries(staff)) {
        if (Array.isArray(list)) staff[gid] = list.filter((a) => a.user_id !== m.user.id);
      }
    }
    for (const a of store.athleteList()) if (a.user_id === m.user.id) a.user_id = null;
    return noContent();
  }),

  // ---------------------------------------------------------------- invitations
  route("GET", `${ORG}/invitations`, ({ store }) => {
    store.requireAdmin();
    const now = nowIso();
    return json(replay(store.invitations).filter((i) => i.accepted_at === null && i.expires_at > now));
  }),
  route("POST", `${ORG}/invitations`, ({ store, body: getBody }) => {
    store.requireAdmin();
    const body = getBody();
    const email = checkEmail(body, "email");
    const role = body.role as OrgRole;
    if (!ORG_ROLES.includes(role)) throw invalidBody("role", "Input should be 'owner', 'admin', 'staff' or 'athlete'", "enum");
    if (role === "owner" && !store.access.is_owner) throw fail(403, "only an owner can invite an owner");
    const athleteId = typeof body.athlete_id === "string" && body.athlete_id ? body.athlete_id : null;
    if (role === "athlete" && !athleteId) throw invalidBody("athlete_id", "Value error, role 'athlete' requires athlete_id");
    if (athleteId) {
      const a = store.athleteList().find((x) => x.id === athleteId);
      if (!a) throw fail(404, "athlete not found");
      if (a.user_id) throw fail(409, "athlete already has a login");
    }
    return json(newInvitation(store, email, role, athleteId), 201);
  }),
  route("DELETE", `${ORG}/invitations/:id`, ({ store, params }) => {
    store.requireAdmin();
    const list = replay(store.invitations);
    const i = list.findIndex((x) => x.id === params.id);
    if (i < 0) throw fail(404, "invitation not found");
    list.splice(i, 1);
    return noContent();
  }),

  // ---------------------------------------------------------------- groups
  route("GET", `${ORG}/groups`, ({ store, req }) => {
    const includeArchived = req.query.get("include_archived") === "true";
    const groups = replay(store.groups)
      .filter((g) => includeArchived || !g.archived)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => store.groupWithCount(g));
    return json(groups);
  }),
  route("POST", `${ORG}/groups`, ({ store, body: getBody }) => {
    store.requireAdmin();
    const body = getBody();
    const name = requiredString(body, "name");
    const kind = body.kind as GroupKind;
    if (!GROUP_KINDS.includes(kind)) throw invalidBody("kind", "Input should be a group kind", "enum");
    const parentId = typeof body.parent_id === "string" && body.parent_id ? body.parent_id : null;
    if (parentId) store.group(parentId, "parent group not found");
    const g: Group = {
      id: newId(),
      org_id: store.orgId,
      parent_id: parentId,
      name,
      kind,
      description: typeof body.description === "string" && body.description ? body.description : null,
      archived: false,
      athlete_count: 0,
      created_at: nowIso(),
    };
    replay(store.groups).push(g);
    if (!isFixtureError(store.staff)) store.staff[g.id] = [];
    return json(g, 201);
  }),
  route("GET", `${ORG}/groups/:id`, ({ store, params }) => json(store.groupWithCount(store.group(params.id!)))),
  route("PATCH", `${ORG}/groups/:id`, ({ store, params, body: getBody }) => {
    store.requireAdmin();
    const g = store.group(params.id!);
    const body = getBody();
    for (const key of ["name", "kind", "archived"]) {
      if (has(body, key) && body[key] === null) throw fail(400, `${key} cannot be null`);
    }
    if (has(body, "parent_id")) {
      const parentId = (body.parent_id as string | null) || null;
      if (parentId) {
        store.group(parentId, "parent group not found");
        if (store.descendants(g.id).has(parentId)) throw fail(400, "a group cannot be moved under itself");
      }
      g.parent_id = parentId;
    }
    if (typeof body.name === "string") g.name = body.name;
    if (typeof body.kind === "string" && GROUP_KINDS.includes(body.kind as GroupKind)) g.kind = body.kind as GroupKind;
    if (has(body, "description")) g.description = (body.description as string | null) || null;
    if (typeof body.archived === "boolean") g.archived = body.archived;
    return json(store.groupWithCount(g));
  }),
  route("DELETE", `${ORG}/groups/:id`, ({ store, params }) => {
    store.requireAdmin();
    store.group(params.id!).archived = true;
    return noContent();
  }),
  route("POST", `${ORG}/groups/:id/athletes`, ({ store, params, body: getBody }) => {
    const g = store.group(params.id!);
    if (!store.canWriteGroup(g.id)) throw fail(403, "write access to the group required");
    const body = getBody();
    const ids = Array.isArray(body.athlete_ids) ? [...new Set(body.athlete_ids.map(String))] : [];
    const athletes = ids.map((id) => {
      const a = store.athleteList().find((x) => x.id === id);
      if (!a) throw fail(404, `athlete ${id} not found`);
      return a;
    });
    for (const a of athletes) if (!a.group_ids.includes(g.id)) a.group_ids.push(g.id);
    return json(store.groupWithCount(g));
  }),
  route("DELETE", `${ORG}/groups/:id/athletes/:athlete`, ({ store, params, req }) => {
    const g = store.group(params.id!);
    if (!store.canWriteGroup(g.id)) throw fail(403, "write access to the group required");
    const a = store.athlete(params.athlete!);
    if (!a.group_ids.includes(g.id)) throw fail(404, "athlete is not a current member of the group");
    const leftOn = req.query.get("left_on");
    if (!leftOn || leftOn <= store.today()) a.group_ids = a.group_ids.filter((x) => x !== g.id);
    return noContent();
  }),

  // ---------------------------------------------------------------- staff assignments
  route("GET", `${ORG}/groups/:id/staff`, ({ store, params }) => {
    store.requireAdmin();
    store.group(params.id!);
    return json(staffMap(store)[params.id!] ?? []);
  }),
  route("POST", `${ORG}/groups/:id/staff`, ({ store, params, body: getBody }) => {
    store.requireAdmin();
    const g = store.group(params.id!);
    const body = getBody();
    const userId = requiredString(body, "user_id");
    const role = body.access_role as AccessRole;
    if (!ACCESS_ROLES.includes(role)) throw invalidBody("access_role", "Input should be an access role", "enum");
    const m = member(store, userId);
    if (m.role === "athlete") throw fail(400, "athletes cannot be assigned as staff");
    const map = staffMap(store);
    const list = (map[g.id] ??= []);
    let a = list.find((x) => x.user_id === userId);
    if (!a) {
      a = { id: newId(), user_id: userId, group_id: g.id, access_role: role, can_view_identifiable: true };
      list.push(a);
    }
    a.access_role = role;
    a.can_view_identifiable = body.can_view_identifiable === undefined ? true : body.can_view_identifiable === true;
    syncMemberAssignments(store);
    return json(a, 201);
  }),
  route("DELETE", `${ORG}/staff-assignments/:id`, ({ store, params }) => {
    store.requireAdmin();
    const map = staffMap(store);
    let found = false;
    for (const [gid, list] of Object.entries(map)) {
      if (list.some((a) => a.id === params.id)) {
        map[gid] = list.filter((a) => a.id !== params.id);
        found = true;
      }
    }
    if (!found) throw fail(404, "assignment not found");
    syncMemberAssignments(store);
    return noContent();
  }),

  // ---------------------------------------------------------------- athletes
  route("GET", `${ORG}/athletes`, listAthletes),
  route("POST", `${ORG}/athletes`, createAthlete),
  route("GET", `${ORG}/athletes/:id`, ({ store, params }) => json(store.athlete(params.id!))),
  route("PATCH", `${ORG}/athletes/:id`, updateAthlete),
  route("DELETE", `${ORG}/athletes/:id`, ({ store, params }) => {
    store.requireAdmin();
    store.athlete(params.id!).status = "archived";
    return noContent();
  }),
  route("POST", `${ORG}/athletes/:id/invite`, inviteAthlete),
];
