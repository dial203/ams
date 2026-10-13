import { queryKeys, type Submission } from "@ams/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, Smartphone } from "lucide-react";
import { useState } from "react";
import { FormRenderer } from "@/components/forms/FormRenderer";
import { Pagination } from "@/components/Pagination";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/lib/api-context";
import { formatDate } from "@/lib/field-format";
import { useOrg } from "@/lib/org";
import { useLogout } from "@/lib/session";

const PAGE = 25;

/** What an athlete sees on the web: a pointer to the mobile app and their own submissions. */
export function AthleteHome() {
  const api = useApi();
  const { orgId, org, me, switchOrg } = useOrg();
  const logout = useLogout();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Submission | null>(null);
  const athlete = useQuery({ queryKey: queryKeys.self.athlete(orgId), queryFn: ({ signal }) => api.self.athlete(orgId, { signal }) });
  const params = { limit: PAGE, offset };
  const subs = useQuery({
    queryKey: queryKeys.self.submissions(orgId, params),
    queryFn: ({ signal }) => api.self.submissions(orgId, params, { signal }),
  });
  const due = useQuery({ queryKey: queryKeys.self.forms(orgId), queryFn: ({ signal }) => api.self.forms(orgId, {}, { signal }) });
  // Forms the athlete may read (names and schemas for submissions of forms they cannot submit).
  const forms = useQuery({
    queryKey: queryKeys.forms.list(orgId, {}),
    queryFn: ({ signal }) => api.forms.list(orgId, {}, { signal }),
    retry: false,
  });
  const formName = (id: string) =>
    due.data?.find((d) => d.form.id === id)?.form.name ?? forms.data?.find((f) => f.id === id)?.name ?? "Form";
  const schemaFor = (s: Submission) => {
    const d = due.data?.find((x) => x.form.id === s.form_id);
    if (d && d.version.id === s.form_version_id) return d.version.schema;
    const f = forms.data?.find((x) => x.id === s.form_id) ?? d?.form;
    return f?.current_version?.id === s.form_version_id ? f.current_version.schema : undefined;
  };

  return (
    <div className="min-h-viewport bg-muted/30">
      <header className="flex h-12 items-center gap-3 border-b bg-background px-4">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">A</span>
        <span className="text-sm font-semibold">{org.name}</span>
        {me.memberships.length > 1 && (
          <NativeSelect size="sm" wrapperClassName="w-48" aria-label="Organization" value={orgId} onChange={(e) => switchOrg(e.target.value)}>
            {me.memberships.map((m) => (
              <option key={m.org.id} value={m.org.id}>
                {m.org.name} ({m.role})
              </option>
            ))}
          </NativeSelect>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={async () => {
            await logout();
            void navigate({ to: "/login" });
          }}
        >
          <LogOut /> Sign out
        </Button>
      </header>
      <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-8">
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-6 sm:flex-row sm:items-center">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand/10">
              <Smartphone aria-hidden className="size-6 text-brand" />
            </div>
            <div className="grid gap-1">
              <h1 className="text-base font-semibold">Hi {athlete.data?.preferred_name || athlete.data?.first_name || me.user.full_name || "there"}, use the AMS mobile app</h1>
              <p className="text-sm text-muted-foreground">
                Daily questionnaires, session logs, your trends and wearable connections live in the app. Sign in there with the same email
                ({me.user.email}). This page only shows what you have submitted.
              </p>
            </div>
          </CardContent>
        </Card>
        {due.data && due.data.some((d) => !d.completed && d.due_time) && (
          <Card>
            <CardHeader>
              <CardTitle>Due today</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 py-3">
              {due.data
                .filter((d) => !d.completed && d.due_time)
                .map((d) => (
                  <Badge key={d.form.id} variant="warning">
                    {d.form.name} · by {d.due_time}
                  </Badge>
                ))}
            </CardContent>
          </Card>
        )}
        <Card className="overflow-hidden">
          <CardHeader>
            <div>
              <CardTitle>My submissions</CardTitle>
              <CardDescription>Forms your organization lets you review.</CardDescription>
            </div>
            {subs.data && <Pagination offset={offset} limit={PAGE} total={subs.data.total} onChange={setOffset} />}
          </CardHeader>
          {subs.isPending ? (
            <Skeleton className="m-4 h-40" />
          ) : subs.isError ? (
            <ErrorState error={subs.error} />
          ) : subs.data.items.length === 0 ? (
            <CardContent className="py-8 text-center text-sm text-muted-foreground">Nothing yet.</CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Day</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead className="text-right">Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subs.data.items.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpen(s)}>
                    <TableCell className="tabular">{formatDate(s.local_date)}</TableCell>
                    <TableCell className="font-medium">{formName(s.form_id)}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </main>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="gap-0 sm:max-w-lg">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>{formName(open.form_id)}</SheetTitle>
                <SheetDescription>{formatDate(open.local_date)}</SheetDescription>
              </SheetHeader>
              <div className="overflow-y-auto p-4">
                {schemaFor(open) ? (
                  <FormRenderer schema={schemaFor(open)!} initialValues={open.values} readOnly compact />
                ) : (
                  <dl className="grid grid-cols-[1fr_auto] gap-1 text-sm">
                    {Object.entries({ ...open.values, ...open.computed }).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="text-right">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
