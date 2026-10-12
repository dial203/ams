import { ORG_ROLES, queryKeys, type Invitation, type OrgRole } from "@ams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailPlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AthletePicker } from "@/components/AthletePicker";
import { CopyButton } from "@/components/CopyButton";
import { FormRow } from "@/components/FormRow";
import { ErrorState, Spinner } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { ORG_ROLE_LABELS } from "@/lib/labels";
import { useOrg } from "@/lib/org";

export function InvitationsSettings() {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, role: myRole, terms } = useOrg();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("staff");
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [created, setCreated] = useState<Invitation | null>(null);
  const invitations = useQuery({
    queryKey: queryKeys.invitations.list(orgId),
    queryFn: ({ signal }) => api.invitations.list(orgId, { signal }),
  });
  const create = useMutation({
    mutationFn: () => api.invitations.create(orgId, { email: email.trim(), role, athlete_id: role === "athlete" ? athleteId : null }),
    onSuccess: (inv) => {
      setCreated(inv);
      setEmail("");
      setAthleteId(null);
      void qc.invalidateQueries({ queryKey: queryKeys.invitations.all(orgId) });
    },
    onError: (e) => toastError(e, "Could not create the invitation"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.invitations.delete(orgId, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.invitations.all(orgId) });
      toast.success("Invitation revoked");
    },
    onError: (e) => toastError(e),
  });
  const valid = /^\S+@\S+\.\S+$/.test(email.trim()) && (role !== "athlete" || !!athleteId);

  return (
    <div className="grid max-w-5xl gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Invite someone</CardTitle>
            <CardDescription>
              Creates a link valid for 7 days. Copy it into your own email or message; the app link works on the web and in the mobile app.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="py-4">
          <form
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) create.mutate();
            }}
          >
            <FormRow label="Email" htmlFor="inv-email">
              <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.org" />
            </FormRow>
            <FormRow label="Role" htmlFor="inv-role">
              <NativeSelect id="inv-role" value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
                {ORG_ROLES.filter((r) => r !== "owner" || myRole === "owner").map((r) => (
                  <option key={r} value={r}>
                    {r === "athlete" ? terms.athlete : ORG_ROLE_LABELS[r]}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            {role === "athlete" ? (
              <FormRow label={`Link to ${terms.athlete.toLowerCase()}`}>
                <AthletePicker value={athleteId} onChange={(id) => setAthleteId(id)} scoped={false} aria-label={`Link to ${terms.athlete.toLowerCase()}`} />
              </FormRow>
            ) : (
              <p className="pb-2 text-xs text-muted-foreground">Staff get access per group after joining (Groups → Staff access).</p>
            )}
            <Button type="submit" disabled={!valid || create.isPending}>
              {create.isPending ? <Spinner className="text-current" /> : <MailPlus />}
              Create invite
            </Button>
          </form>
          {created && (
            <Alert variant="info" className="mt-4">
              <MailPlus />
              <AlertTitle>Invitation for {created.email}</AlertTitle>
              <AlertDescription>
                <div className="flex w-full max-w-2xl gap-2">
                  <Input readOnly value={created.invite_url} aria-label="Invite link" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <CopyButton value={created.invite_url} label="Copy invite link" />
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
        </CardHeader>
        {invitations.isPending ? (
          <Skeleton className="m-4 h-24" />
        ) : invitations.isError ? (
          <ErrorState error={invitations.error} />
        ) : invitations.data.length === 0 ? (
          <CardContent className="py-6 text-center text-sm text-muted-foreground">No pending invitations.</CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.data.map((inv) => {
                const expired = new Date(inv.expires_at).getTime() < Date.now();
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{inv.role === "athlete" ? terms.athlete : ORG_ROLE_LABELS[inv.role]}</Badge>
                    </TableCell>
                    <TableCell className={expired ? "text-destructive" : "text-muted-foreground"}>
                      {expired ? "Expired " : ""}
                      {new Date(inv.expires_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex gap-1">
                        <CopyButton value={inv.invite_url} label={`Copy link for ${inv.email}`} variant="ghost" />
                        <Button variant="ghost" size="icon-sm" aria-label={`Revoke invitation for ${inv.email}`} onClick={() => revoke.mutate(inv.id)}>
                          <Trash2 />
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
