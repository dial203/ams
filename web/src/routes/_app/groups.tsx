import {
  ACCESS_ROLES,
  GROUP_KINDS,
  athleteLabel,
  queryKeys,
  type AccessRole,
  type Athlete,
  type Group,
  type GroupCreate,
  type GroupKind,
} from "@ams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, ChevronRight, EyeOff, Network, Pencil, Plus, Search, ShieldCheck, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { AthleteName } from "@/components/athletes/AthleteBits";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormRow } from "@/components/FormRow";
import { GroupKindIcon } from "@/components/GroupKindIcon";
import { GroupPicker } from "@/components/GroupPicker";
import { PageHeader } from "@/components/page";
import { EmptyState, ErrorState, Spinner } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDebounced } from "@/hooks/use-debounced";
import { useApi } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { buildGroupTree, groupPath, type GroupNode } from "@/lib/groups";
import { ACCESS_ROLE_HINTS, ACCESS_ROLE_LABELS, GROUP_KIND_LABELS } from "@/lib/labels";
import { useOrg } from "@/lib/org";
import { useAthletes, useGroups, useMembers } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/groups")({
  validateSearch: z.object({ id: z.string().optional() }),
  component: GroupsPage,
});

function GroupsPage() {
  const { terms, isAdmin, groupId: globalGroup } = useOrg();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const groups = useGroups({ includeArchived: showArchived });
  const tree = useMemo(() => buildGroupTree(groups.data ?? []), [groups.data]);
  const selectedId = search.id ?? globalGroup ?? tree[0]?.group.id ?? null;
  const selected = groups.data?.find((g) => g.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={terms.groups}
        description={`Hierarchy of teams, squads, units and study cohorts. Staff access applies to a ${terms.group.toLowerCase()} and everything below it.`}
        actions={
          isAdmin && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New {terms.group.toLowerCase()}
            </Button>
          )
        }
      />
      <div className="grid min-h-0 flex-1 md:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b md:border-r md:border-b-0" aria-label={`${terms.groups} tree`}>
          <div className="flex-1 overflow-y-auto p-2">
            {groups.isPending ? (
              <div className="grid gap-1.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-7" />
                ))}
              </div>
            ) : groups.isError ? (
              <ErrorState error={groups.error} />
            ) : tree.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">No {terms.groups.toLowerCase()} yet.</p>
            ) : (
              <ul role="tree" aria-label={terms.groups}>
                {tree.map((n) => (
                  <TreeNode key={n.group.id} node={n} selectedId={selectedId} onSelect={(id) => void navigate({ search: { id }, replace: true })} />
                ))}
              </ul>
            )}
          </div>
          <label className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
          </label>
        </aside>
        <section className="min-h-0 overflow-y-auto px-4 py-4 md:px-6">
          {selected ? (
            <GroupDetail key={selected.id} group={selected} groups={groups.data ?? []} />
          ) : (
            !groups.isPending && <EmptyState icon={Network} title={`Select a ${terms.group.toLowerCase()}`} />
          )}
        </section>
      </div>
      {creating && <GroupDialog onClose={() => setCreating(false)} groups={groups.data ?? []} onSaved={(g) => void navigate({ search: { id: g.id } })} />}
    </div>
  );
}

function TreeNode({ node, selectedId, onSelect }: { node: GroupNode; selectedId: string | null; onSelect(id: string): void }) {
  const [open, setOpen] = useState(true);
  const g = node.group;
  const selected = g.id === selectedId;
  return (
    <li role="treeitem" aria-expanded={node.children.length ? open : undefined} aria-selected={selected}>
      <div className="flex items-center" style={{ paddingLeft: node.depth * 14 }}>
        <button
          type="button"
          aria-label={open ? "Collapse" : "Expand"}
          onClick={() => setOpen(!open)}
          className={cn("flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground", node.children.length === 0 && "invisible")}
          tabIndex={-1}
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <button
          type="button"
          onClick={() => onSelect(g.id)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40",
            selected && "bg-accent font-medium",
            g.archived && "text-muted-foreground",
          )}
        >
          <GroupKindIcon kind={g.kind} className="size-3.5" />
          <span className={cn("truncate", g.archived && "line-through")}>{g.name}</span>
          <span className="ml-auto text-xs text-muted-foreground tabular">{g.athlete_count}</span>
        </button>
      </div>
      {open && node.children.length > 0 && (
        <ul role="group">
          {node.children.map((c) => (
            <TreeNode key={c.group.id} node={c} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

function GroupDetail({ group, groups }: { group: Group; groups: Group[] }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, isAdmin, terms, setGroupId, groupId } = useOrg();
  const [editing, setEditing] = useState(false);
  const archive = useMutation({
    mutationFn: () => (group.archived ? api.groups.update(orgId, group.id, { archived: false }) : api.groups.delete(orgId, group.id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all(orgId) });
      toast.success(group.archived ? "Restored" : "Archived");
    },
    onError: (e) => toastError(e),
  });
  const path = groupPath(groups, group.id);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{path.split(" › ").slice(0, -1).join(" › ") || "Top level"}</div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <GroupKindIcon kind={group.kind} className="size-4" />
            {group.name}
            <Badge variant="outline">{GROUP_KIND_LABELS[group.kind]}</Badge>
            {group.archived && <Badge variant="muted">Archived</Badge>}
          </h2>
          {group.description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{group.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setGroupId(group.id)} disabled={groupId === group.id}>
            {groupId === group.id ? "Current filter" : "Use as filter"}
          </Button>
          {isAdmin && (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
              <Button size="sm" variant="outline" onClick={() => archive.mutate()} disabled={archive.isPending}>
                {group.archived ? <ArchiveRestore /> : <Archive />}
                {group.archived ? "Restore" : "Archive"}
              </Button>
            </>
          )}
        </div>
      </div>
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">{terms.athletes}</TabsTrigger>
          {isAdmin && <TabsTrigger value="staff">Staff access</TabsTrigger>}
        </TabsList>
        <TabsContent value="members">
          <MembersTab group={group} />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="staff">
            <StaffTab group={group} />
          </TabsContent>
        )}
      </Tabs>
      {editing && <GroupDialog group={group} groups={groups} onClose={() => setEditing(false)} />}
    </div>
  );
}

function MembersTab({ group }: { group: Group }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, terms, today } = useOrg();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Athlete | null>(null);
  const [leftOn, setLeftOn] = useState(today);
  const athletes = useAthletes({ group_id: group.id, limit: 500 });
  const direct = (athletes.data?.items ?? []).filter((a) => a.group_ids.includes(group.id));
  const viaChildren = (athletes.data?.items ?? []).filter((a) => !a.group_ids.includes(group.id));

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.athletes.all(orgId) });
    void qc.invalidateQueries({ queryKey: queryKeys.groups.all(orgId) });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboards.all(orgId) });
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {direct.length} direct member{direct.length === 1 ? "" : "s"}
          {viaChildren.length > 0 && ` · ${viaChildren.length} more in sub-${terms.groups.toLowerCase()}`}
        </p>
        <Button size="sm" onClick={() => setAdding(true)} disabled={group.archived}>
          <UserPlus /> Add {terms.athletes.toLowerCase()}
        </Button>
      </div>
      {athletes.isPending ? (
        <Skeleton className="h-48" />
      ) : athletes.isError ? (
        <ErrorState error={athletes.error} />
      ) : direct.length + viaChildren.length === 0 ? (
        <Card>
          <EmptyState title={`No ${terms.athletes.toLowerCase()} yet`} description="Add people to start tracking them in this group." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Membership</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...direct, ...viaChildren].map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link to="/athletes/$athleteId" params={{ athleteId: a.id }} className="hover:underline">
                      <AthleteName athlete={a} />
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.position ?? "–"}</TableCell>
                  <TableCell>{a.group_ids.includes(group.id) ? <Badge variant="secondary">Direct</Badge> : <span className="text-xs text-muted-foreground">Via sub-group</span>}</TableCell>
                  <TableCell className="text-right">
                    {a.group_ids.includes(group.id) && (
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(a)} aria-label={`Remove ${athleteLabel(a)}`}>
                        <UserMinus /> Remove
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {adding && <AddMembersDialog group={group} existing={new Set(direct.map((a) => a.id))} onClose={() => setAdding(false)} onDone={invalidate} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing ? athleteLabel(removing) : ""} from ${group.name}?`}
        description={`Membership history is kept: past data still shows they were in this ${terms.group.toLowerCase()} until the leaving date.`}
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          try {
            await api.groups.removeAthlete(orgId, group.id, removing!.id, { left_on: leftOn });
            invalidate();
            toast.success(`Removed from ${group.name}`);
          } catch (e) {
            toastError(e, "Could not remove");
            throw e;
          }
        }}
      >
        <FormRow label="Left on" htmlFor="left-on">
          <Input id="left-on" type="date" value={leftOn} max={today} onChange={(e) => setLeftOn(e.target.value)} className="w-44" />
        </FormRow>
      </ConfirmDialog>
    </div>
  );
}

function AddMembersDialog({ group, existing, onClose, onDone }: { group: Group; existing: Set<string>; onClose(): void; onDone(): void }) {
  const api = useApi();
  const { orgId, terms, today } = useOrg();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 200);
  const [picked, setPicked] = useState<Map<string, Athlete>>(new Map());
  const [joinedOn, setJoinedOn] = useState(today);
  const list = useAthletes({ q: dq || null, status: "active", limit: 100 });
  const add = useMutation({
    mutationFn: () => api.groups.addAthletes(orgId, group.id, { athlete_ids: [...picked.keys()], joined_on: joinedOn }),
    onSuccess: () => {
      toast.success(`Added ${picked.size} to ${group.name}`);
      onDone();
      onClose();
    },
    onError: (e) => toastError(e, "Could not add"),
  });
  const candidates = (list.data?.items ?? []).filter((a) => !existing.has(a.id));
  const toggle = (a: Athlete) => {
    const next = new Map(picked);
    if (next.has(a.id)) next.delete(a.id);
    else next.set(a.id, a);
    setPicked(next);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add {terms.athletes.toLowerCase()} to {group.name}</DialogTitle>
          <DialogDescription>They keep their other memberships.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or code…" aria-label="Search" className="pl-8" autoFocus />
        </div>
        <div className="max-h-72 overflow-y-auto rounded-md border">
          {list.isPending ? (
            <div className="p-3">
              <Spinner />
            </div>
          ) : candidates.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No one else to add.</p>
          ) : (
            candidates.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent/50">
                <Checkbox checked={picked.has(a.id)} onCheckedChange={() => toggle(a)} />
                <AthleteName athlete={a} />
                <span className="ml-auto truncate text-xs text-muted-foreground">{a.position}</span>
              </label>
            ))
          )}
        </div>
        <FormRow label="Joined on" htmlFor="joined-on">
          <Input id="joined-on" type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} className="w-44" />
        </FormRow>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => add.mutate()} disabled={picked.size === 0 || add.isPending}>
            {add.isPending && <Spinner className="text-current" />}
            Add {picked.size || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StaffTab({ group }: { group: Group }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, terms } = useOrg();
  const members = useMembers();
  const staff = useQuery({
    queryKey: queryKeys.groups.staff(orgId, group.id),
    queryFn: ({ signal }) => api.staffAssignments.list(orgId, group.id, { signal }),
  });
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<AccessRole>("coach");
  const [identifiable, setIdentifiable] = useState(true);
  const userName = (id: string) => {
    const m = members.data?.find((x) => x.user.id === id);
    return m ? m.user.full_name || m.user.email : "Unknown user";
  };
  const eligible = (members.data ?? []).filter((m) => m.role !== "athlete");
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.groups.staff(orgId, group.id) });
    void qc.invalidateQueries({ queryKey: queryKeys.members.all(orgId) });
  };
  const add = useMutation({
    mutationFn: () => api.staffAssignments.create(orgId, group.id, { user_id: userId, access_role: role, can_view_identifiable: identifiable }),
    onSuccess: () => {
      invalidate();
      setUserId("");
      toast.success("Access granted");
    },
    onError: (e) => toastError(e, "Could not assign"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.staffAssignments.delete(orgId, id),
    onSuccess: () => {
      invalidate();
      toast.success("Access removed");
    },
    onError: (e) => toastError(e),
  });

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Assignments apply to {group.name} and every sub-{terms.group.toLowerCase()}. Owners and admins see everything without an assignment.
      </p>
      {staff.isPending ? (
        <Skeleton className="h-32" />
      ) : staff.isError ? (
        <ErrorState error={staff.error} />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Staff member</TableHead>
                <TableHead>Access role</TableHead>
                <TableHead>Identifiable data</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.data.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    No staff assigned to this {terms.group.toLowerCase()} directly.
                  </TableCell>
                </TableRow>
              )}
              {staff.data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{userName(s.user_id)}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck aria-hidden className="size-3.5 text-muted-foreground" />
                      {ACCESS_ROLE_LABELS[s.access_role]}
                      <span className="text-xs text-muted-foreground">· {ACCESS_ROLE_HINTS[s.access_role]}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {s.can_view_identifiable ? (
                      "Names visible"
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <EyeOff aria-hidden /> Codes only
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${userName(s.user_id)}`} onClick={() => remove.mutate(s.id)}>
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Card className="p-4">
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (userId) add.mutate();
          }}
        >
          <FormRow label="Staff member" htmlFor="sa-user">
            <NativeSelect id="sa-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose…</option>
              {eligible.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.full_name || m.user.email} ({m.role})
                </option>
              ))}
            </NativeSelect>
          </FormRow>
          <FormRow label="Access role" htmlFor="sa-role">
            <NativeSelect id="sa-role" value={role} onChange={(e) => setRole(e.target.value as AccessRole)}>
              {ACCESS_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ACCESS_ROLE_LABELS[r]}
                </option>
              ))}
            </NativeSelect>
          </FormRow>
          <label className="flex h-8 items-center gap-2 text-sm">
            <Switch checked={identifiable} onCheckedChange={setIdentifiable} /> Can see names
          </label>
          <Button type="submit" disabled={!userId || add.isPending}>
            {add.isPending ? <Spinner className="text-current" /> : <Plus />}
            Assign
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">{ACCESS_ROLE_HINTS[role]}. Without “Can see names”, the staff member sees codes only (blinded assessment, de-identified analysis).</p>
      </Card>
    </div>
  );
}

function GroupDialog({ group, groups, onClose, onSaved }: { group?: Group; groups: Group[]; onClose(): void; onSaved?(g: Group): void }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, terms } = useOrg();
  const [v, setV] = useState<GroupCreate>({
    name: group?.name ?? "",
    kind: group?.kind ?? "team",
    parent_id: group?.parent_id ?? null,
    description: group?.description ?? "",
  });
  // A group cannot move under itself or a descendant.
  const blocked = useMemo(() => {
    if (!group) return new Set<string>();
    const out = new Set([group.id]);
    let added = true;
    while (added) {
      added = false;
      for (const g of groups) if (g.parent_id && out.has(g.parent_id) && !out.has(g.id)) {
        out.add(g.id);
        added = true;
      }
    }
    return out;
  }, [group, groups]);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...v, name: v.name.trim(), description: v.description?.trim() || null };
      return group ? api.groups.update(orgId, group.id, body) : api.groups.create(orgId, body);
    },
    onSuccess: (g) => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all(orgId) });
      toast.success(group ? "Saved" : `${g.name} created`);
      onSaved?.(g);
      onClose();
    },
    onError: (e) => toastError(e, "Could not save"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group ? `Edit ${group.name}` : `New ${terms.group.toLowerCase()}`}</DialogTitle>
        </DialogHeader>
        <form
          id="group-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (v.name.trim()) save.mutate();
          }}
        >
          <FormRow label="Name" htmlFor="g-name">
            <Input id="g-name" autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </FormRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow label="Kind" htmlFor="g-kind">
              <NativeSelect id="g-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as GroupKind })}>
                {GROUP_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {GROUP_KIND_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            <FormRow label="Parent" htmlFor="g-parent">
              <GroupPicker
                id="g-parent"
                groups={groups.filter((g) => !blocked.has(g.id) && !g.archived)}
                value={v.parent_id ?? null}
                onChange={(id) => setV({ ...v, parent_id: id })}
                allLabel="None (top level)"
              />
            </FormRow>
          </div>
          <FormRow label="Description" htmlFor="g-desc" optional>
            <Textarea id="g-desc" rows={2} value={v.description ?? ""} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </FormRow>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="group-form" disabled={!v.name.trim() || save.isPending}>
            {save.isPending && <Spinner className="text-current" />}
            {group ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
