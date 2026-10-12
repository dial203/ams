import {
  athleteLabel,
  isApiError,
  isISODate,
  queryKeys,
  type BulkSubmissionCreate,
  type Form,
  type Submission,
  type SubmissionValidation,
} from "@ams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { CircleCheck, ClipboardList, Grid3x3, SquarePen, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { AthletePicker } from "@/components/AthletePicker";
import { TeamGrid, type GridAthlete } from "@/components/entry/TeamGrid";
import { FormRenderer } from "@/components/forms/FormRenderer";
import { GroupPicker } from "@/components/GroupPicker";
import { PageBody, PageHeader } from "@/components/page";
import { EmptyState, ErrorState, Spinner } from "@/components/states";
import { SubmissionSheet } from "@/components/submissions/SubmissionSheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { formatDate } from "@/lib/field-format";
import { useOrg } from "@/lib/org";
import { publishedForms, useAthletes, useForms, useGroups } from "@/lib/queries";

export const Route = createFileRoute("/_app/entry")({
  validateSearch: z.object({
    mode: z.enum(["single", "grid"]).optional(),
    form: z.string().optional(),
    athlete: z.string().optional(),
    group: z.string().optional(),
    date: z.string().optional(),
  }),
  component: EntryPage,
});

function EntryPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { today } = useOrg();
  const mode = search.mode ?? (search.athlete ? "single" : "grid");
  const date = search.date && isISODate(search.date) ? search.date : today;
  const forms = useForms();
  const available = publishedForms(forms.data);
  const formId = search.form && available.some((f) => f.id === search.form) ? search.form : (available[0]?.id ?? "");
  const form = available.find((f) => f.id === formId);

  const setSearch = (patch: Partial<typeof search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  return (
    <>
      <PageHeader
        title="Data entry"
        description="Record questionnaires, sessions and tests for one person or the whole group."
        actions={
          <Tabs value={mode} onValueChange={(m) => setSearch({ mode: m as "single" | "grid" })}>
            <TabsList className="h-8 gap-1 rounded-md border-0 bg-muted p-0.5">
              <TabsTrigger value="grid" className="h-7 rounded-[5px] border-0 px-2.5 data-[state=active]:bg-background data-[state=active]:shadow-xs">
                <Grid3x3 /> Team grid
              </TabsTrigger>
              <TabsTrigger value="single" className="h-7 rounded-[5px] border-0 px-2.5 data-[state=active]:bg-background data-[state=active]:shadow-xs">
                <SquarePen /> Single entry
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="entry-form" className="text-xs text-muted-foreground">
              Form
            </Label>
            <NativeSelect
              id="entry-form"
              size="sm"
              wrapperClassName="w-64"
              value={formId}
              onChange={(e) => setSearch({ form: e.target.value })}
              disabled={forms.isPending || available.length === 0}
            >
              {forms.isPending && <option>Loading…</option>}
              {available.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {mode === "single" ? (
            <SingleControls athleteId={search.athlete ?? null} onAthlete={(id) => setSearch({ athlete: id ?? undefined })} />
          ) : (
            <GridControls groupId={search.group ?? null} onGroup={(g) => setSearch({ group: g ?? undefined })} />
          )}
          <div className="grid gap-1">
            <Label htmlFor="entry-date" className="text-xs text-muted-foreground">
              Day
            </Label>
            <Input
              id="entry-date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && isISODate(e.target.value) && setSearch({ date: e.target.value === today ? undefined : e.target.value })}
              className="h-7 w-40 text-xs"
            />
          </div>
        </div>
      </PageHeader>
      <PageBody className="flex min-h-0 flex-col">
        {forms.isPending ? (
          <Skeleton className="h-64" />
        ) : forms.isError ? (
          <ErrorState error={forms.error} onRetry={() => void forms.refetch()} />
        ) : !form ? (
          <EmptyState
            icon={ClipboardList}
            title="No published forms"
            description="Publish a form (or install a template) before entering data."
            action={
              <Button asChild size="sm" variant="outline">
                <Link to="/forms">Go to forms</Link>
              </Button>
            }
          />
        ) : mode === "single" ? (
          <SingleEntry form={form} athleteId={search.athlete ?? null} date={date} />
        ) : (
          <GridEntry form={form} groupId={search.group ?? null} date={date} />
        )}
      </PageBody>
    </>
  );
}

function SingleControls({ athleteId, onAthlete }: { athleteId: string | null; onAthlete(id: string | null): void }) {
  const { terms } = useOrg();
  return (
    <div className="grid gap-1">
      <Label className="text-xs text-muted-foreground">{terms.athlete}</Label>
      <AthletePicker value={athleteId} onChange={(id) => onAthlete(id)} size="sm" className="w-64" aria-label={terms.athlete} />
    </div>
  );
}

function GridControls({ groupId, onGroup }: { groupId: string | null; onGroup(id: string | null): void }) {
  const { terms, groupId: globalGroup } = useOrg();
  const groups = useGroups();
  return (
    <div className="grid gap-1">
      <Label className="text-xs text-muted-foreground">{terms.group}</Label>
      <GroupPicker
        aria-label={terms.group}
        groups={groups.data ?? []}
        value={groupId ?? globalGroup}
        onChange={onGroup}
        placeholder={`Choose ${terms.group.toLowerCase()}…`}
        size="sm"
        className="h-7 w-56"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single entry

function SingleEntry({ form, athleteId, date }: { form: Form; athleteId: string | null; date: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, terms } = useOrg();
  const [serverErrors, setServerErrors] = useState<Record<string, string> | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [round, setRound] = useState(0);
  const [last, setLast] = useState<Submission | null>(null);
  const [open, setOpen] = useState<Submission | null>(null);
  const schema = form.current_version!.schema;

  const create = useMutation({
    mutationFn: (r: SubmissionValidation) =>
      api.submissions.create(orgId, { form_id: form.id, athlete_id: athleteId!, values: r.values, local_date: date }),
    onSuccess: (s) => {
      setServerErrors(null);
      setDuplicate(false);
      setLast(s);
      setRound((n) => n + 1);
      toast.success(`Saved ${form.name}`, { description: `${s.athlete_display_name} · ${formatDate(s.local_date)}` });
      void qc.invalidateQueries({ queryKey: queryKeys.submissions.all(orgId) });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboards.all(orgId) });
      void qc.invalidateQueries({ queryKey: queryKeys.metrics.allSeries(orgId) });
    },
    onError: (e) => {
      if (isApiError(e) && e.status === 422 && e.fieldErrors) {
        setServerErrors(e.fieldErrors);
        toast.error("Some values were rejected by the server");
      } else if (isApiError(e) && e.status === 409) {
        setDuplicate(true);
      } else toastError(e, "Could not save");
    },
  });

  const existing = useQuery({
    queryKey: queryKeys.submissions.list(orgId, { form_id: form.id, athlete_id: athleteId, start: date, end: date }),
    queryFn: ({ signal }) => api.submissions.list(orgId, { form_id: form.id, athlete_id: athleteId, start: date, end: date }, { signal }),
    enabled: !!athleteId,
  });
  const already = existing.data?.items ?? [];

  if (!athleteId) {
    return (
      <EmptyState
        icon={Users}
        title={`Choose a ${terms.athlete.toLowerCase()}`}
        description={`Pick a form, a ${terms.athlete.toLowerCase()} and the day, then fill in the form.`}
      />
    );
  }

  return (
    <div className="grid max-w-3xl gap-4">
      {duplicate && (
        <Alert variant="warning">
          <AlertTitle>Already submitted for {formatDate(date)}</AlertTitle>
          <AlertDescription>
            <p>{form.name} allows one submission per day. Edit the existing one instead.</p>
            {already[0] && (
              <Button size="sm" variant="outline" className="mt-1" onClick={() => setOpen(already[0]!)}>
                Open existing submission
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {!duplicate && already.length > 0 && (
        <Alert variant={form.allow_multiple_per_day ? "info" : "warning"}>
          <CircleCheck />
          <AlertTitle>
            {already.length === 1 ? "There is already a submission" : `There are ${already.length} submissions`} for this day
          </AlertTitle>
          <AlertDescription>
            {!form.allow_multiple_per_day && <p>{form.name} allows one per day, so a new one would be rejected. Edit the existing one instead.</p>}
            <Button size="sm" variant="link" className="h-auto p-0" onClick={() => setOpen(already[0]!)}>
              {form.allow_multiple_per_day ? `View ${already.length === 1 ? "it" : "the latest"}` : "Open and edit it"}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {last && (
        <p className="text-xs text-muted-foreground" role="status">
          Last saved: {last.athlete_display_name}, {formatDate(last.local_date)}.{" "}
          <button type="button" className="text-brand hover:underline" onClick={() => setOpen(last)}>
            View
          </button>
        </p>
      )}
      <Card>
        <CardContent className="py-5">
          <FormRenderer
            key={`${form.id}:${athleteId}:${date}:${round}`}
            schema={schema}
            serverErrors={serverErrors}
            onSubmit={(r) => create.mutate(r)}
            busy={create.isPending}
            submitLabel="Save submission"
          />
        </CardContent>
      </Card>
      <SubmissionSheet submission={open} form={form} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team grid

function GridEntry({ form, groupId: explicitGroup, date }: { form: Form; groupId: string | null; date: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, terms, groupId: globalGroup } = useOrg();
  const groupId = explicitGroup ?? globalGroup;
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState<Submission | null>(null);

  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm("You have unsaved entries in the grid. Leave and discard them?"),
    enableBeforeUnload: () => dirty,
  });

  const athletes = useAthletes({ group_id: groupId, status: "active", limit: 500 }, { enabled: !!groupId });
  const subsParams = { form_id: form.id, group_id: groupId, start: date, end: date, limit: 500 };
  const existing = useQuery({
    queryKey: queryKeys.submissions.list(orgId, subsParams),
    queryFn: ({ signal }) => api.submissions.list(orgId, subsParams, { signal }),
    enabled: !!groupId,
  });
  const existingByAthlete = useMemo(() => {
    const m = new Map<string, Submission[]>();
    for (const s of existing.data?.items ?? []) {
      const list = m.get(s.athlete_id) ?? [];
      list.push(s);
      m.set(s.athlete_id, list);
    }
    return m;
  }, [existing.data]);

  const gridAthletes = useMemo<GridAthlete[]>(
    () =>
      (athletes.data?.items ?? [])
        .slice()
        .sort((a, b) => athleteLabel(a).localeCompare(athleteLabel(b)))
        .map((a) => ({ id: a.id, label: athleteLabel(a), sublabel: a.masked ? undefined : a.code })),
    [athletes.data],
  );

  const bulk = useMutation({
    mutationFn: (payload: BulkSubmissionCreate) => api.submissions.bulkCreate(orgId, payload),
    onSuccess: () => {
      void existing.refetch();
      void qc.invalidateQueries({ queryKey: queryKeys.dashboards.all(orgId) });
      void qc.invalidateQueries({ queryKey: queryKeys.metrics.allSeries(orgId) });
      void qc.invalidateQueries({ queryKey: queryKeys.submissions.lists(orgId), refetchType: "none" });
    },
  });

  if (!groupId) {
    return (
      <EmptyState
        icon={Users}
        title={`Choose a ${terms.group.toLowerCase()}`}
        description={`The grid lists every active ${terms.athlete.toLowerCase()} in the ${terms.group.toLowerCase()}, one row each.`}
      />
    );
  }
  if (athletes.isPending || existing.isPending) return <Skeleton className="h-80" />;
  if (athletes.isError) return <ErrorState error={athletes.error} onRetry={() => void athletes.refetch()} />;
  if (gridAthletes.length === 0) {
    return <EmptyState icon={Users} title={`No active ${terms.athletes.toLowerCase()} in this ${terms.group.toLowerCase()}`} />;
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {existing.isFetching && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> Checking existing submissions…
        </div>
      )}
      <TeamGrid
        key={`${form.id}:${groupId}:${date}`}
        form={form}
        schema={form.current_version!.schema}
        athletes={gridAthletes}
        date={date}
        existing={existingByAthlete}
        onSave={(payload) => bulk.mutateAsync(payload)}
        onOpenSubmission={setOpen}
        onDirtyChange={setDirty}
      />
      <SubmissionSheet submission={open} form={form} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  );
}
