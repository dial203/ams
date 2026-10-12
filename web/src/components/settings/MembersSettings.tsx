import { ORG_ROLES, queryKeys, type Member, type OrgRole } from "@ams/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserMinus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { ACCESS_ROLE_LABELS, ORG_ROLE_LABELS } from "@/lib/labels";
import { useOrg } from "@/lib/org";
import { useGroups, useMembers } from "@/lib/queries";

export function MembersSettings() {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, isAdmin, role: myRole, me, terms } = useOrg();
  const members = useMembers();
  const groups = useGroups();
  const [removing, setRemoving] = useState<Member | null>(null);
  const groupName = (id: string) => groups.data?.find((g) => g.id === id)?.name ?? "Unknown";
  const update = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: OrgRole }) => api.members.update(orgId, userId, { role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.members.all(orgId) });
      toast.success("Role updated");
    },
    onError: (e) => toastError(e, "Could not change the role"),
  });

  if (members.isPending) return <Skeleton className="h-64 max-w-5xl" />;
  if (members.isError) return <ErrorState error={members.error} onRetry={() => void members.refetch()} />;
  const sorted = [...members.data].sort((a, b) => ORG_ROLES.indexOf(a.role) - ORG_ROLES.indexOf(b.role) || (a.user.full_name || a.user.email).localeCompare(b.user.full_name || b.user.email));

  return (
    <div className="grid max-w-5xl gap-3">
      <p className="text-sm text-muted-foreground">
        Owners and admins see everything. Staff see the {terms.groups.toLowerCase()} they are assigned to (Groups → Staff access). {terms.athletes} only see their own data in the app.
      </p>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Access</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((m) => {
              const self = m.user.id === me.user.id;
              const canEdit = isAdmin && !self && (m.role !== "owner" || myRole === "owner");
              return (
                <TableRow key={m.user.id}>
                  <TableCell className="font-medium">
                    {m.user.full_name || "–"} {self && <Badge variant="muted">You</Badge>}
                    {!m.user.is_active && <Badge variant="muted" className="ml-1">Inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.user.email}</TableCell>
                  <TableCell>
                    {canEdit && m.role !== "athlete" ? (
                      <NativeSelect
                        size="sm"
                        wrapperClassName="w-28"
                        aria-label={`Role of ${m.user.email}`}
                        value={m.role}
                        onChange={(e) => update.mutate({ userId: m.user.id, role: e.target.value as OrgRole })}
                      >
                        {ORG_ROLES.filter((r) => r !== "athlete" && (r !== "owner" || myRole === "owner")).map((r) => (
                          <option key={r} value={r}>
                            {ORG_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Badge variant={m.role === "owner" || m.role === "admin" ? "brand" : "secondary"}>{ORG_ROLE_LABELS[m.role]}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-80 truncate text-xs text-muted-foreground">
                    {m.role === "owner" || m.role === "admin"
                      ? "Everything"
                      : m.role === "athlete"
                        ? "Own data"
                        : m.assignments.length === 0
                          ? "No assignments"
                          : m.assignments.map((a) => `${groupName(a.group_id)} (${ACCESS_ROLE_LABELS[a.access_role]}${a.can_view_identifiable ? "" : ", codes only"})`).join(", ")}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.user.email}`} onClick={() => setRemoving(m)}>
                        <UserMinus />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.user.full_name || removing?.user.email} from the organization?`}
        description="They lose access immediately. Data they entered is kept."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          try {
            await api.members.delete(orgId, removing!.user.id);
            void qc.invalidateQueries({ queryKey: queryKeys.members.all(orgId) });
            toast.success("Member removed");
          } catch (e) {
            toastError(e, "Could not remove");
            throw e;
          }
        }}
      />
    </div>
  );
}
