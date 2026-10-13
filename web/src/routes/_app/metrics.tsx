import {
  addDays,
  isApiError,
  queryKeys,
  type DailyAgg,
  type MetricCreate,
  type MetricDefinition,
  type ThresholdDirection,
  type Transform,
} from "@ams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LineChart as LineChartIcon, Plus, Save, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { AthletePicker } from "@/components/AthletePicker";
import { MetricChart } from "@/components/charts/MetricChart";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormRow } from "@/components/FormRow";
import { SourcePicker } from "@/components/metrics/SourcePicker";
import { PageHeader } from "@/components/page";
import { EmptyState, ErrorState, Spinner } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/api-context";
import { useDemoMode } from "@/lib/demo-mode";
import { toastError } from "@/lib/errors";
import { formatNumber } from "@/lib/field-format";
import { sameJson } from "@/lib/json";
import { DAILY_AGG_LABELS, TRANSFORM_LABELS } from "@/lib/labels";
import { METRIC_SLUG, TRANSFORM_HELP, TRANSFORM_PARAMS, emptyMetric, hasCaveat, paramsFor, toEditable } from "@/lib/metrics";
import { useOrg } from "@/lib/org";
import { useMetrics, useSeriesSources } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/metrics")({
  validateSearch: z.object({ slug: z.string().optional(), athlete: z.string().optional() }),
  component: MetricsPage,
});

function MetricsPage() {
  const { isAdmin } = useOrg();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const metrics = useMetrics();
  const selectedSlug = search.slug ?? metrics.data?.[0]?.slug;
  const selected = search.slug === "new" ? null : (metrics.data?.find((m) => m.slug === selectedSlug) ?? null);
  const creating = search.slug === "new";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Metrics"
        description="Daily series per person, computed on demand from forms, wearables or other metrics."
        actions={
          isAdmin && (
            <Button size="sm" onClick={() => void navigate({ search: (p) => ({ ...p, slug: "new" }) })}>
              <Plus /> New metric
            </Button>
          )
        }
      />
      <div className="grid min-h-0 flex-1 md:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b p-2 md:border-r md:border-b-0" aria-label="Metric definitions">
          {metrics.isPending ? (
            <div className="grid gap-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : metrics.isError ? (
            <ErrorState error={metrics.error} />
          ) : (
            <ul className="grid gap-0.5">
              {metrics.data.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => void navigate({ search: (p) => ({ ...p, slug: m.slug }), replace: true })}
                    aria-current={m.slug === selectedSlug && !creating ? "true" : undefined}
                    className={cn(
                      "grid w-full gap-0.5 rounded-md px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40",
                      m.slug === selectedSlug && !creating && "bg-accent",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{m.name}</span>
                      {m.builtin && <Badge variant="muted" className="ml-auto">Built-in</Badge>}
                    </span>
                    <span className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                      <code className="font-mono">{m.slug}</code> · {TRANSFORM_LABELS[m.transform]}
                      {m.thresholds && <span title="Has thresholds" className="ml-auto size-1.5 shrink-0 rounded-full bg-flag-amber" />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="min-h-0 overflow-y-auto px-4 py-4 md:px-6">
          {creating ? (
            <MetricEditor key="new" metric={null} />
          ) : selected ? (
            <MetricEditor key={selected.id} metric={selected} />
          ) : (
            !metrics.isPending && <EmptyState icon={LineChartIcon} title="No metric selected" />
          )}
        </section>
      </div>
    </div>
  );
}

function MetricEditor({ metric }: { metric: MetricDefinition | null }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const { orgId, isAdmin, terms } = useOrg();
  const sources = useSeriesSources();
  const [v, setV] = useState<MetricCreate>(() => (metric ? toEditable(metric) : emptyMetric()));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<string | null>(null);
  const original = metric ? toEditable(metric) : emptyMetric();
  const dirty = !sameJson(v, original);
  const set = (patch: Partial<MetricCreate>) => setV((p) => ({ ...p, ...patch }));
  const slugError = !metric && v.slug && !METRIC_SLUG.test(v.slug) ? "Lowercase letters, digits and _; start with a letter" : null;
  const invalid = !v.name.trim() || !v.source || (!metric && (!v.slug || !!slugError));

  const save = useMutation({
    mutationFn: async () => {
      const body: MetricCreate = { ...v, name: v.name.trim(), description: v.description?.trim() || null, unit: v.unit?.trim() || null };
      if (!metric) return api.metrics.create(orgId, body);
      const patch: Partial<MetricCreate> = {};
      for (const k of Object.keys(body) as (keyof MetricCreate)[]) {
        if (k !== "slug" && !sameJson(body[k], original[k])) (patch as Record<string, unknown>)[k] = body[k];
      }
      return api.metrics.update(orgId, metric.id, patch);
    },
    onSuccess: (m) => {
      setFieldErrors(null);
      qc.setQueryData<MetricDefinition[]>(queryKeys.metrics.list(orgId), (list) =>
        list ? (list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m]) : list,
      );
      void qc.invalidateQueries({ queryKey: queryKeys.metrics.all(orgId) });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboards.all(orgId) });
      toast.success(metric ? "Metric saved" : "Metric created");
      if (!metric) void navigate({ search: (p) => ({ ...p, slug: m.slug }), replace: true });
    },
    onError: (e) => {
      if (isApiError(e) && (e.status === 422 || e.status === 409)) setFieldErrors(e.detail);
      toastError(e, "Could not save the metric");
    },
  });

  const caveat = hasCaveat(v);
  const specs = TRANSFORM_PARAMS[v.transform];
  const t = v.thresholds;

  return (
    <div className="grid max-w-5xl gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            {metric ? metric.name : "New metric"}
            {metric?.builtin && <Badge variant="muted">Built-in</Badge>}
          </h2>
          {metric && <code className="font-mono text-xs text-muted-foreground">{metric.slug}</code>}
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {metric && !metric.builtin && (
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </Button>
            )}
            {metric && dirty && (
              <Button variant="ghost" size="sm" onClick={() => setV(original)}>
                Discard
              </Button>
            )}
            <Button size="sm" onClick={() => save.mutate()} disabled={(!dirty && !!metric) || invalid || save.isPending}>
              {save.isPending ? <Spinner className="text-current" /> : <Save />}
              {metric ? "Save" : "Create metric"}
            </Button>
          </div>
        )}
      </div>

      {caveat && v.description && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Read before using this metric</AlertTitle>
          <AlertDescription className="text-foreground/80">
            <p>{v.description}</p>
          </AlertDescription>
        </Alert>
      )}
      {fieldErrors && (
        <Alert variant="destructive">
          <AlertDescription className="text-destructive">{fieldErrors}</AlertDescription>
        </Alert>
      )}

      <fieldset disabled={!isAdmin} className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Definition</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 py-4 sm:grid-cols-2">
            <FormRow label="Name" htmlFor="m-name" className="sm:col-span-2">
              <Input id="m-name" value={v.name} onChange={(e) => set({ name: e.target.value })} />
            </FormRow>
            {!metric && (
              <FormRow label="Slug" htmlFor="m-slug" error={slugError} hint="Used in metric:<slug> references and URLs">
                <Input id="m-slug" value={v.slug} onChange={(e) => set({ slug: e.target.value })} className="font-mono text-xs" />
              </FormRow>
            )}
            <FormRow label="Description" htmlFor="m-desc" className="sm:col-span-2" hint="Shown to staff; document method, references and caveats.">
              <Textarea id="m-desc" rows={3} value={v.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
            </FormRow>
            <FormRow label="Source" htmlFor="m-source" className="sm:col-span-2" error={!v.source && v.name ? "Required" : undefined}>
              {sources.isPending ? (
                <Skeleton className="h-8" />
              ) : (
                <SourcePicker
                  id="m-source"
                  sources={sources.data ?? []}
                  value={v.source}
                  exclude={metric ? `metric:${metric.slug}` : undefined}
                  onChange={(ref, s) => set({ source: ref, unit: v.unit ?? s?.unit ?? null })}
                />
              )}
            </FormRow>
            <FormRow label="Daily aggregation" htmlFor="m-agg" hint="How a day with several values becomes one">
              <NativeSelect id="m-agg" value={v.daily_agg} onChange={(e) => set({ daily_agg: e.target.value as DailyAgg })}>
                {(Object.keys(DAILY_AGG_LABELS) as DailyAgg[]).map((a) => (
                  <option key={a} value={a}>
                    {DAILY_AGG_LABELS[a]}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            <label className="flex items-start gap-2 self-end pb-1 text-sm">
              <Switch checked={v.fill_zero} onCheckedChange={(c) => set({ fill_zero: c })} className="mt-0.5" />
              <span>
                Days without data count as 0
                <span className="block text-xs text-muted-foreground">For loads only. Otherwise missing stays missing.</span>
              </span>
            </label>
            <FormRow label="Unit" htmlFor="m-unit">
              <Input id="m-unit" value={v.unit ?? ""} onChange={(e) => set({ unit: e.target.value || null })} />
            </FormRow>
            <FormRow label="Decimals" htmlFor="m-dec">
              <Input id="m-dec" type="number" min={0} max={6} value={v.decimals} onChange={(e) => set({ decimals: Math.max(0, Math.min(6, Number(e.target.value) || 0)) })} />
            </FormRow>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Switch checked={v.athlete_visible} onCheckedChange={(c) => set({ athlete_visible: c })} /> Visible to {terms.athletes.toLowerCase()} in the app
            </label>
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Transform</CardTitle>
                <CardDescription>{TRANSFORM_HELP[v.transform]}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 py-4">
              <FormRow label="Transform" htmlFor="m-transform">
                <NativeSelect
                  id="m-transform"
                  value={v.transform}
                  onChange={(e) => {
                    const tr = e.target.value as Transform;
                    set({ transform: tr, params: paramsFor(tr, v.params) });
                  }}
                >
                  {(Object.keys(TRANSFORM_LABELS) as Transform[]).map((tr) => (
                    <option key={tr} value={tr}>
                      {TRANSFORM_LABELS[tr]}
                    </option>
                  ))}
                </NativeSelect>
              </FormRow>
              {specs.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {specs.map((p) => {
                    const val = v.params[p.key];
                    const setParam = (x: number | string | boolean | undefined) => {
                      const next = { ...v.params };
                      if (x === undefined || x === "") delete next[p.key];
                      else next[p.key] = x;
                      set({ params: next });
                    };
                    if (p.kind === "bool") {
                      return (
                        <label key={p.key} className="flex items-start gap-2 text-sm">
                          <Switch checked={val === true || (val === undefined && p.default === "true")} onCheckedChange={(c) => setParam(c)} className="mt-0.5" aria-label={p.label} />
                          <span>
                            {p.label}
                            {p.hint && <span className="block text-xs text-muted-foreground">{p.hint}</span>}
                          </span>
                        </label>
                      );
                    }
                    if (p.kind === "select") {
                      return (
                        <FormRow key={p.key} label={p.label} htmlFor={`mp-${p.key}`}>
                          <NativeSelect id={`mp-${p.key}`} value={typeof val === "string" ? val : ""} onChange={(e) => setParam(e.target.value || undefined)}>
                            <option value="">Default ({p.default})</option>
                            {p.options!.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </NativeSelect>
                        </FormRow>
                      );
                    }
                    return (
                      <FormRow key={p.key} label={p.label} htmlFor={`mp-${p.key}`} hint={p.hint ?? `Default: ${p.default}`}>
                        <Input
                          id={`mp-${p.key}`}
                          type="number"
                          min={0}
                          step={p.kind === "int" ? 1 : "any"}
                          placeholder={p.default}
                          value={typeof val === "number" ? val : ""}
                          onChange={(e) => setParam(e.target.value === "" ? undefined : p.kind === "int" ? Math.round(Number(e.target.value)) : Number(e.target.value))}
                        />
                      </FormRow>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Thresholds</CardTitle>
                <CardDescription>Flags on the readiness board and charts. Leave off for metrics without agreed cut-offs.</CardDescription>
              </div>
              <Switch
                checked={t !== null}
                onCheckedChange={(c) => set({ thresholds: c ? { direction: "high_bad", amber: null, red: null } : null })}
                aria-label="Use thresholds"
              />
            </CardHeader>
            {t && (
              <CardContent className="grid gap-4 py-4 sm:grid-cols-3">
                <FormRow label="Direction" htmlFor="m-dir">
                  <NativeSelect id="m-dir" value={t.direction} onChange={(e) => set({ thresholds: { ...t, direction: e.target.value as ThresholdDirection } })}>
                    <option value="high_bad">High is bad</option>
                    <option value="low_bad">Low is bad</option>
                    <option value="both_bad">Both (absolute value)</option>
                  </NativeSelect>
                </FormRow>
                <FormRow label="Amber at" htmlFor="m-amber">
                  <Input id="m-amber" type="number" step="any" value={t.amber ?? ""} onChange={(e) => set({ thresholds: { ...t, amber: e.target.value === "" ? null : Number(e.target.value) } })} />
                </FormRow>
                <FormRow label="Red at" htmlFor="m-red">
                  <Input id="m-red" type="number" step="any" value={t.red ?? ""} onChange={(e) => set({ thresholds: { ...t, red: e.target.value === "" ? null : Number(e.target.value) } })} />
                </FormRow>
                <p className="text-xs text-muted-foreground sm:col-span-3">{thresholdSentence(t)}</p>
              </CardContent>
            )}
          </Card>
        </div>
      </fieldset>

      <PreviewCard metric={metric} dirty={dirty} onSave={() => save.mutate()} saving={save.isPending} canSave={isAdmin && !invalid} />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${metric?.name}?`}
        description="Metrics that use it as a source, and the readiness board, stop showing it."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await api.metrics.delete(orgId, metric!.id);
            void qc.invalidateQueries({ queryKey: queryKeys.metrics.all(orgId) });
            toast.success("Metric deleted");
            void navigate({ search: (p) => ({ ...p, slug: undefined }), replace: true });
          } catch (e) {
            toastError(e, "Could not delete");
            throw e;
          }
        }}
      />
    </div>
  );
}

function thresholdSentence(t: NonNullable<MetricCreate["thresholds"]>): string {
  const a = t.amber === null ? null : formatNumber(t.amber);
  const r = t.red === null ? null : formatNumber(t.red);
  const cmp = t.direction === "low_bad" ? "≤" : "≥";
  const subject = t.direction === "both_bad" ? "|value|" : "value";
  const parts = [r !== null ? `red when ${subject} ${cmp} ${r}` : null, a !== null ? `amber when ${subject} ${cmp} ${a}` : null].filter(Boolean);
  return parts.length ? `Flags: ${parts.join(", ")}, otherwise green. Missing values get no flag.` : "Set amber and/or red values.";
}

function PreviewCard({ metric, dirty, onSave, saving, canSave }: { metric: MetricDefinition | null; dirty: boolean; onSave(): void; saving: boolean; canSave: boolean }) {
  const api = useApi();
  const { orgId, today, terms } = useOrg();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const athleteId = search.athlete ?? null;
  const start = addDays(today, -55);
  const params = { athlete_id: athleteId ?? "", start, end: today };
  const series = useQuery({
    queryKey: queryKeys.metrics.series(orgId, metric?.slug ?? "", params),
    queryFn: ({ signal }) => api.metrics.series(orgId, metric!.slug, params, { signal }),
    enabled: !!metric && !!athleteId,
  });
  const values = series.data?.points.filter((p) => p.value !== null).length ?? 0;
  const demo = useDemoMode();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Preview</CardTitle>
          <CardDescription>Last 8 weeks for one {terms.athlete.toLowerCase()}, computed by the server from the saved definition.</CardDescription>
        </div>
        <AthletePicker value={athleteId} onChange={(id) => void navigate({ search: (p) => ({ ...p, athlete: id ?? undefined }), replace: true })} scoped={false} className="w-60" size="sm" aria-label={`Preview ${terms.athlete.toLowerCase()}`} />
      </CardHeader>
      <CardContent className="grid gap-3 py-4">
        {!metric ? (
          <p className="text-sm text-muted-foreground">Create the metric to preview it.</p>
        ) : (
          <>
            {dirty && (
              <Alert variant="info">
                <AlertDescription className="flex flex-wrap items-center gap-2 text-foreground/80">
                  The chart shows the saved definition. Save to see your changes.
                  {canSave && (
                    <Button size="sm" variant="outline" onClick={onSave} disabled={saving}>
                      {saving ? <Spinner className="text-current" /> : <Save />} Save and preview
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {!athleteId ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Choose a {terms.athlete.toLowerCase()} to preview.</p>
            ) : series.isPending ? (
              <Skeleton className="h-56" />
            ) : series.isError ? (
              <ErrorState error={series.error} />
            ) : (
              <>
                <MetricChart metric={series.data.metric} points={series.data.points} height={220} />
                <p className="text-xs text-muted-foreground">
                  {values} of {series.data.points.length} days have a value.
                  {demo && values === 0 && " The demo serves the series the API computed when it was built; metrics created or redefined here are not computed."}
                </p>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
