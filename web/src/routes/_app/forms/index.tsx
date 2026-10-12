import { zodResolver } from "@hookform/resolvers/zod";
import {
  FORM_KINDS,
  SENSITIVITIES,
  emptySchema,
  insertSection,
  newSection,
  queryKeys,
  type FormCreate,
  type FormKind,
  type FormTemplate,
} from "@ams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ClipboardList, Download, Eye, LayoutTemplate, Plus, Smartphone } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FormRow } from "@/components/FormRow";
import { KindBadge, SensitivityBadge } from "@/components/forms/FormBadges";
import { PageBody, PageHeader, Toolbar } from "@/components/page";
import { EmptyState, ErrorState, Spinner } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { sameJson } from "@/lib/json";
import { FORM_KIND_LABELS, SENSITIVITY_LABELS } from "@/lib/labels";
import { useOrg } from "@/lib/org";
import { useForms } from "@/lib/queries";

export const Route = createFileRoute("/_app/forms/")({
  component: FormsPage,
});

function FormsPage() {
  const { isAdmin, terms } = useOrg();
  const navigate = useNavigate();
  const [kind, setKind] = useState<FormKind | "">("");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState(false);
  const forms = useForms({ kind: kind || null, include_archived: archived || null });

  return (
    <>
      <PageHeader
        title="Forms"
        description="Questionnaires, session logs, tests and medical records. Published versions are immutable."
        actions={
          isAdmin && (
            <>
              <Button size="sm" variant="outline" onClick={() => setTemplates(true)}>
                <LayoutTemplate /> From template
              </Button>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> New form
              </Button>
            </>
          )
        }
      >
        <Toolbar>
          <NativeSelect aria-label="Kind" size="sm" wrapperClassName="w-44" value={kind} onChange={(e) => setKind(e.target.value as FormKind | "")}>
            <option value="">All kinds</option>
            {FORM_KINDS.map((k) => (
              <option key={k} value={k}>
                {FORM_KIND_LABELS[k]}
              </option>
            ))}
          </NativeSelect>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={archived} onCheckedChange={setArchived} aria-label="Show archived" />
            Show archived
          </label>
        </Toolbar>
      </PageHeader>
      <PageBody className="p-0 md:p-0">
        {forms.isPending ? (
          <div className="grid gap-1.5 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : forms.isError ? (
          <ErrorState error={forms.error} onRetry={() => void forms.refetch()} />
        ) : forms.data.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No forms yet"
            description="Start from a validated template (Hooper wellness, session RPE, CMJ, GPS…) or build your own."
            action={
              isAdmin && (
                <Button size="sm" onClick={() => setTemplates(true)}>
                  <LayoutTemplate /> Browse templates
                </Button>
              )
            }
          />
        ) : (
          <Table containerClassName="px-2 md:px-4">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Sensitivity</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>{terms.athlete} app</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.data.map((f) => {
                const changed = f.current_version && !sameJson(f.draft_schema, f.current_version.schema);
                return (
                  <TableRow key={f.id} className="cursor-pointer" onClick={() => void navigate({ to: "/forms/$formId", params: { formId: f.id } })}>
                    <TableCell className="max-w-[28rem]">
                      <button
                        type="button"
                        className="block max-w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        onClick={(e) => {
                          e.stopPropagation();
                          void navigate({ to: "/forms/$formId", params: { formId: f.id } });
                        }}
                      >
                        <span className="font-medium">{f.name}</span>
                        {f.archived && <Badge variant="muted" className="ml-2">Archived</Badge>}
                        {f.description && <span className="block truncate text-xs text-muted-foreground">{f.description}</span>}
                      </button>
                    </TableCell>
                    <TableCell>
                      <KindBadge kind={f.kind} />
                    </TableCell>
                    <TableCell>
                      <SensitivityBadge sensitivity={f.sensitivity} />
                    </TableCell>
                    <TableCell>
                      {f.current_version ? (
                        <span className="inline-flex items-center gap-1.5 tabular">
                          v{f.current_version.version}
                          {changed && <Badge variant="warning">Draft changes</Badge>}
                        </span>
                      ) : (
                        <Badge variant="warning">Unpublished</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Smartphone aria-label={f.athlete_can_submit ? "Athletes submit" : "Staff only"} className={f.athlete_can_submit ? "size-3.5 text-foreground" : "size-3.5 opacity-25"} />
                        <Eye aria-label={f.athlete_can_view ? "Athletes can view" : "Hidden from athletes"} className={f.athlete_can_view ? "size-3.5 text-foreground" : "size-3.5 opacity-25"} />
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground tabular">
                      {new Date(f.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </PageBody>
      <NewFormDialog open={creating} onOpenChange={setCreating} />
      <TemplatesDialog open={templates} onOpenChange={setTemplates} />
    </>
  );
}

const newFormSchema = z.object({
  name: z.string().trim().min(1, "Required").max(200),
  description: z.string().max(2000),
  kind: z.enum(FORM_KINDS as unknown as [FormKind, ...FormKind[]]),
  sensitivity: z.enum(["general", "medical", "research"]),
  athlete_can_submit: z.boolean(),
});
type NewFormValues = z.infer<typeof newFormSchema>;

function NewFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { orgId, terms } = useOrg();
  const form = useForm<NewFormValues>({
    resolver: zodResolver(newFormSchema),
    defaultValues: { name: "", description: "", kind: "questionnaire", sensitivity: "general", athlete_can_submit: true },
  });
  const create = useMutation({
    mutationFn: (body: FormCreate) => api.forms.create(orgId, body),
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.all(orgId) });
      onOpenChange(false);
      form.reset();
      void navigate({ to: "/forms/$formId", params: { formId: f.id } });
    },
    onError: (e) => toastError(e, "Could not create the form"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New form</DialogTitle>
          <DialogDescription>You will land in the builder. Nothing is visible to {terms.athletes.toLowerCase()} until you publish.</DialogDescription>
        </DialogHeader>
        <form
          id="new-form"
          className="grid gap-4"
          noValidate
          onSubmit={form.handleSubmit((v) =>
            create.mutate({
              name: v.name.trim(),
              description: v.description.trim() || null,
              kind: v.kind,
              sensitivity: v.sensitivity,
              athlete_can_submit: v.athlete_can_submit,
              athlete_can_view: v.athlete_can_submit && v.sensitivity === "general",
              draft_schema: insertSection(emptySchema(), newSection("main", "Questions")),
            }),
          )}
        >
          <FormRow label="Name" htmlFor="nf-name" error={form.formState.errors.name?.message}>
            <Input id="nf-name" autoFocus {...form.register("name")} />
          </FormRow>
          <FormRow label="Description" htmlFor="nf-desc" optional>
            <Textarea id="nf-desc" rows={2} {...form.register("description")} />
          </FormRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow label="Kind" htmlFor="nf-kind">
              <NativeSelect id="nf-kind" {...form.register("kind")}>
                {FORM_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {FORM_KIND_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            <FormRow label="Sensitivity" htmlFor="nf-sens" hint="Controls which staff roles can read submissions">
              <NativeSelect id="nf-sens" {...form.register("sensitivity")}>
                {SENSITIVITIES.map((s) => (
                  <option key={s} value={s}>
                    {SENSITIVITY_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.watch("athlete_can_submit")} onCheckedChange={(v) => form.setValue("athlete_can_submit", v)} />
            {terms.athletes} fill it in the mobile app
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-form" disabled={create.isPending}>
            {create.isPending && <Spinner className="text-current" />}
            Create and open builder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { orgId } = useOrg();
  const [picked, setPicked] = useState<FormTemplate | null>(null);
  const [name, setName] = useState("");
  const templates = useQuery({
    queryKey: queryKeys.formTemplates.list(orgId),
    queryFn: ({ signal }) => api.formTemplates.list(orgId, { signal }),
    enabled: open,
    staleTime: 10 * 60_000,
  });
  const install = useMutation({
    mutationFn: (t: FormTemplate) => api.formTemplates.install(orgId, t.key, name.trim() ? { name: name.trim() } : {}),
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.all(orgId) });
      void qc.invalidateQueries({ queryKey: queryKeys.metrics.seriesSources(orgId) });
      toast.success(`Installed ${f.name}`, { description: "Published as version 1." });
      onOpenChange(false);
      setPicked(null);
      void navigate({ to: "/forms/$formId", params: { formId: f.id } });
    },
    onError: (e) => toastError(e, "Could not install the template"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setPicked(null);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{picked ? picked.name : "Form templates"}</DialogTitle>
          <DialogDescription>
            {picked ? picked.description : "Validated instruments, installed as a published form you can then adapt."}
          </DialogDescription>
        </DialogHeader>
        {templates.isPending ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : templates.isError ? (
          <ErrorState error={templates.error} />
        ) : picked ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-1.5">
              <KindBadge kind={picked.kind} />
              <SensitivityBadge sensitivity={picked.sensitivity} />
              <Badge variant="muted">{picked.schema.sections.reduce((n, s) => n + s.fields.length, 0)} fields</Badge>
            </div>
            {picked.references.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <div className="mb-1 font-medium text-foreground">References</div>
                <ul className="list-disc space-y-0.5 pl-4">
                  {picked.references.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            <FormRow label="Form name" htmlFor="tpl-name" hint="Leave empty to use the template name">
              <Input id="tpl-name" placeholder={picked.name} value={name} onChange={(e) => setName(e.target.value)} />
            </FormRow>
          </div>
        ) : (
          <div className="grid max-h-[60vh] gap-2 overflow-y-auto sm:grid-cols-2">
            {templates.data.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setPicked(t);
                  setName("");
                }}
                className="grid gap-2 rounded-lg border p-3 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{t.name}</span>
                  <SensitivityBadge sensitivity={t.sensitivity} />
                </div>
                <span className="line-clamp-2 text-xs text-muted-foreground">{t.description}</span>
                <span className="text-xs text-muted-foreground">
                  {FORM_KIND_LABELS[t.kind]} · {t.schema.sections.reduce((n, s) => n + s.fields.length, 0)} fields
                </span>
              </button>
            ))}
          </div>
        )}
        {picked && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicked(null)}>
              Back
            </Button>
            <Button onClick={() => install.mutate(picked)} disabled={install.isPending}>
              {install.isPending ? <Spinner className="text-current" /> : <Download />}
              Install
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
