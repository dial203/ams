import { isApiError, queryKeys, validateSchema, type Form, type FormSchema, type SchemaError } from "@ams/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, CircleAlert, Rocket, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { FormBuilder } from "@/components/builder/FormBuilder";
import { describePath } from "@/components/builder/builder-logic";
import { KindBadge, SensitivityBadge } from "@/components/forms/FormBadges";
import { FormSchedulesTab } from "@/components/forms/FormSchedulesTab";
import { FormSettingsTab } from "@/components/forms/FormSettingsTab";
import { FormVersionsTab } from "@/components/forms/FormVersionsTab";
import { ErrorState, Spinner } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { sameJson } from "@/lib/json";
import { useOrg } from "@/lib/org";
import { useForm } from "@/lib/queries";
import { useDocumentTitle } from "@/hooks/use-document-title";

const TABS = ["build", "settings", "schedules", "versions"] as const;

export const Route = createFileRoute("/_app/forms/$formId")({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  component: FormBuilderPage,
});

function FormBuilderPage() {
  const { formId } = Route.useParams();
  const form = useForm(formId);
  if (form.isPending) {
    return (
      <div className="grid gap-3 p-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-[60vh]" />
      </div>
    );
  }
  if (form.isError) return <ErrorState error={form.error} title="Could not load the form" onRetry={() => void form.refetch()} />;
  return <FormEditor key={form.data.id} form={form.data} />;
}

function FormEditor({ form }: { form: Form }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, isAdmin } = useOrg();
  const { tab = "build" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [draft, setDraft] = useState<FormSchema>(form.draft_schema);
  const [saved, setSaved] = useState<FormSchema>(form.draft_schema);
  const [serverErrors, setServerErrors] = useState<SchemaError[]>([]);
  const dirty = !sameJson(draft, saved);
  const published = form.current_version;
  const draftDiffersFromPublished = !published || !sameJson(draft, published.schema);
  const clientErrorCount = validateSchema(draft).length;
  useDocumentTitle(form.name);

  useBlocker({
    shouldBlockFn: ({ next }) => dirty && next.pathname !== `/forms/${form.id}` && !window.confirm("Discard unsaved changes to this form?"),
    enableBeforeUnload: () => dirty,
  });

  const setForm = (f: Form) => {
    qc.setQueryData(queryKeys.forms.detail(orgId, f.id), f);
    void qc.invalidateQueries({ queryKey: queryKeys.forms.lists(orgId) });
  };

  const saveDraft = useMutation({
    mutationFn: (schema: FormSchema) => api.forms.update(orgId, form.id, { draft_schema: schema }),
    onSuccess: (f, schema) => {
      setSaved(schema);
      setForm(f);
    },
    onError: (e) => toastError(e, "Could not save the draft"),
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) await saveDraft.mutateAsync(draft);
      return api.forms.publish(orgId, form.id);
    },
    onSuccess: (v) => {
      setServerErrors([]);
      void qc.invalidateQueries({ queryKey: queryKeys.forms.all(orgId) });
      void qc.invalidateQueries({ queryKey: queryKeys.metrics.seriesSources(orgId) });
      if (published && v.id === published.id) toast("Nothing new to publish", { description: `Version ${v.version} is current.` });
      else toast.success(`Published version ${v.version}`, { description: "New submissions use this version; older ones keep theirs." });
    },
    onError: (e) => {
      if (isApiError(e) && e.schemaErrors) {
        setServerErrors(e.schemaErrors);
        toast.error("The server rejected the schema", { description: `${e.schemaErrors.length} problem(s) to fix` });
        void navigate({ search: { tab: undefined }, replace: true });
      } else toastError(e, "Could not publish");
    },
  });

  const onChange = useCallback((s: FormSchema) => {
    setDraft(s);
    setServerErrors([]);
  }, []);

  // Ctrl/Cmd+S saves the draft.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && tab === "build") {
        e.preventDefault();
        if (dirty && !saveDraft.isPending) saveDraft.mutate(draft, { onSuccess: () => toast.success("Draft saved") });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, draft, saveDraft, tab]);

  return (
    <Tabs
      value={tab}
      onValueChange={(t) => void navigate({ search: { tab: t === "build" ? undefined : (t as (typeof TABS)[number]) }, replace: true })}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <div className="border-b px-4 pt-3 md:px-6">
        <Link to="/forms" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft aria-hidden className="size-3.5" /> Forms
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight">{form.name}</h1>
            <KindBadge kind={form.kind} />
            <SensitivityBadge sensitivity={form.sensitivity} />
            {published ? <Badge variant="secondary">v{published.version} live</Badge> : <Badge variant="warning">Never published</Badge>}
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {saveDraft.isPending ? "Saving…" : dirty ? "Unsaved changes" : draftDiffersFromPublished && published ? "Draft differs from live version" : "All changes saved"}
            </span>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              {clientErrorCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-destructive">
                  <CircleAlert aria-hidden className="size-3.5" /> {clientErrorCount} to fix before publishing
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveDraft.mutate(draft, { onSuccess: () => toast.success("Draft saved") })}
                disabled={!dirty || saveDraft.isPending}
              >
                {saveDraft.isPending ? <Spinner className="text-current" /> : <Save />}
                Save draft
              </Button>
              <Button size="sm" onClick={() => publish.mutate()} disabled={publish.isPending || (!dirty && !draftDiffersFromPublished)}>
                {publish.isPending ? <Spinner className="text-current" /> : <Rocket />}
                Publish
              </Button>
            </div>
          )}
        </div>
        <TabsList className="mt-1 border-b-0">
          <TabsTrigger value="build">Build</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>
      </div>
      {serverErrors.length > 0 && tab === "build" && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <CircleAlert />
          <AlertTitle>Publishing failed: the server found {serverErrors.length} problem(s)</AlertTitle>
          <AlertDescription className="text-destructive/90">
            <ul className="list-disc pl-4">
              {serverErrors.slice(0, 6).map((e) => (
                <li key={e.path + e.message}>
                  <span className="font-medium">{describePath(draft, e.path)}</span>: {e.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <TabsContent value="build" className="lg:min-h-0 lg:flex-1">
        <FormBuilder schema={draft} onChange={onChange} serverErrors={serverErrors} readOnly={!isAdmin} />
      </TabsContent>
      <TabsContent value="settings" className="overflow-y-auto px-4 py-4 md:px-6">
        <FormSettingsTab form={form} onSaved={setForm} />
      </TabsContent>
      <TabsContent value="schedules" className="overflow-y-auto px-4 py-4 md:px-6">
        <FormSchedulesTab form={form} />
      </TabsContent>
      <TabsContent value="versions" className="overflow-y-auto px-4 py-4 md:px-6">
        <FormVersionsTab
          form={form}
          onRestore={(schema) => {
            setDraft(schema);
            void navigate({ search: { tab: undefined }, replace: true });
            toast("Version copied into the draft", { description: "Save or publish to keep it." });
          }}
        />
      </TabsContent>
    </Tabs>
  );
}
