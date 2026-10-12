import { queryKeys, type Athlete, type Invitation } from "@ams/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Smartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AthleteFields } from "@/components/athletes/AthleteForm";
import { CopyButton } from "@/components/CopyButton";
import { FormRow } from "@/components/FormRow";
import { Spinner } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/api-context";
import { athleteFormDefaults, toAthleteUpdate, useAthleteForm } from "@/lib/athlete-form";
import { toastError } from "@/lib/errors";
import { useOrg } from "@/lib/org";
import { useGroups } from "@/lib/queries";

export function ProfileTab({ athlete }: { athlete: Athlete }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, terms } = useOrg();
  const groups = useGroups();
  const form = useAthleteForm(athleteFormDefaults(athlete));
  const save = useMutation({
    mutationFn: (body: ReturnType<typeof toAthleteUpdate>) => api.athletes.update(orgId, athlete.id, body),
    onSuccess: (a) => {
      qc.setQueryData(queryKeys.athletes.detail(orgId, a.id), a);
      void qc.invalidateQueries({ queryKey: queryKeys.athletes.lists(orgId) });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboards.all(orgId) });
      form.reset(athleteFormDefaults(a));
      toast.success("Profile saved");
    },
    onError: (e) => toastError(e, "Could not save"),
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Changes are recorded in the audit log.</CardDescription>
          </div>
        </CardHeader>
        <form
          noValidate
          onSubmit={form.handleSubmit((v) => {
            const body = toAthleteUpdate(v, athlete);
            if (Object.keys(body).length === 0) {
              toast("Nothing changed");
              return;
            }
            save.mutate(body);
          })}
        >
          <CardContent className="py-4">
            <AthleteFields
              form={form}
              mode="edit"
              groups={groups.data ?? []}
              masked={athlete.masked}
              athleteTerm={terms.athlete}
              groupsTerm={terms.groups}
            />
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="ghost" type="button" onClick={() => form.reset(athleteFormDefaults(athlete))} disabled={!form.formState.isDirty}>
              Reset
            </Button>
            <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
              {save.isPending && <Spinner className="text-current" />}
              Save profile
            </Button>
          </CardFooter>
        </form>
      </Card>
      <AppAccessCard athlete={athlete} />
    </div>
  );
}

function AppAccessCard({ athlete }: { athlete: Athlete }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, terms } = useOrg();
  const [email, setEmail] = useState("");
  const [invite, setInvite] = useState<Invitation | null>(null);
  const send = useMutation({
    mutationFn: () => api.athletes.invite(orgId, athlete.id, email.trim() ? { email: email.trim() } : {}),
    onSuccess: (inv) => {
      setInvite(inv);
      void qc.invalidateQueries({ queryKey: queryKeys.invitations.all(orgId) });
      toast.success("Invitation created", { description: inv.email });
    },
    onError: (e) => toastError(e, "Could not invite"),
  });

  return (
    <Card className="h-fit">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Smartphone aria-hidden className="size-4 text-muted-foreground" /> Mobile app
          </CardTitle>
          <CardDescription>
            {terms.athletes} complete questionnaires and connect wearables in the AMS app.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 py-4">
        {athlete.user_id ? (
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="success">Has a login</Badge>
            <span className="text-muted-foreground">They can sign in to the app.</span>
          </div>
        ) : invite ? (
          <div className="grid gap-2">
            <p className="text-sm">
              Invitation for <span className="font-medium">{invite.email}</span>, valid until{" "}
              {new Date(invite.expires_at).toLocaleDateString()}.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={invite.invite_url} aria-label="Invite link" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <CopyButton value={invite.invite_url} label="Copy invite link" />
            </div>
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              send.mutate();
            }}
          >
            {(!athlete.email || athlete.masked) && (
              <FormRow label="Email" htmlFor="invite-email" hint={athlete.masked ? "Uses the email on file when empty" : "No email on file"}>
                <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </FormRow>
            )}
            {athlete.email && !athlete.masked && (
              <p className="text-sm text-muted-foreground">
                Sends to <span className="text-foreground">{athlete.email}</span>.
              </p>
            )}
            <Button type="submit" variant="outline" disabled={send.isPending || (!athlete.email && !athlete.masked && !email.trim())}>
              {send.isPending ? <Spinner className="text-current" /> : <Mail />}
              Invite to app
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
