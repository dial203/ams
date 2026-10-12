import {
  addDays,
  formatMetricValue,
  queryKeys,
  valueFields,
  type Athlete,
  type Form,
  type MetricDefinition,
  type Submission,
} from "@ams/shared";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LineChart as LineChartIcon } from "lucide-react";
import { MetricChart } from "@/components/charts/MetricChart";
import { FlagIcon } from "@/components/readiness/FlagIcon";
import { EmptyState, ErrorState } from "@/components/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/api-context";
import { EMPTY_TEXT, formatDate, formatFieldValue } from "@/lib/field-format";
import { useOrg } from "@/lib/org";
import { useForms, useMetrics, useSubmissions } from "@/lib/queries";
import { cn } from "@/lib/utils";

const DAYS = 42;

export function OverviewTab({ athlete }: { athlete: Athlete }) {
  const api = useApi();
  const { org, orgId, today } = useOrg();
  const metrics = useMetrics();
  const slugs = org.settings.readiness_metrics ?? [];
  const defs = slugs
    .map((s) => metrics.data?.find((m) => m.slug === s))
    .filter((m): m is MetricDefinition => !!m);
  const start = addDays(today, -(DAYS - 1));
  const series = useQueries({
    queries: defs.map((m) => {
      const params = { athlete_id: athlete.id, start, end: today };
      return {
        queryKey: queryKeys.metrics.series(orgId, m.slug, params),
        queryFn: ({ signal }: { signal: AbortSignal }) => api.metrics.series(orgId, m.slug, params, { signal }),
      };
    }),
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-labelledby="trends-h" className="grid content-start gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="trends-h" className="text-sm font-semibold">
            Readiness trends <span className="font-normal text-muted-foreground">· last 6 weeks</span>
          </h2>
          <Link to="/metrics" className="text-xs text-muted-foreground hover:text-foreground">
            Metric definitions
          </Link>
        </div>
        {metrics.isPending ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-52" />
            ))}
          </div>
        ) : defs.length === 0 ? (
          <Card>
            <EmptyState icon={LineChartIcon} title="No readiness metrics selected" description="Choose them in Settings → Organization." />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {defs.map((m, i) => {
              const q = series[i]!;
              const points = q.data?.points ?? [];
              const latest = [...points].reverse().find((p) => p.value !== null);
              return (
                <Card key={m.slug} className="gap-0">
                  <CardHeader className="border-b-0 pb-1">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{m.name}</CardTitle>
                      <CardDescription>{latest ? `Latest ${formatDate(latest.date)}` : "No recent value"}</CardDescription>
                    </div>
                    <div className="flex items-center gap-1.5 text-base font-semibold tabular">
                      <FlagIcon flag={latest?.flag ?? null} />
                      <span className={cn(latest?.flag === "red" && "text-flag-red")}>{formatMetricValue(latest?.value ?? null, m)}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {q.isPending ? (
                      <Skeleton className="h-40" />
                    ) : q.isError ? (
                      <ErrorState error={q.error} className="py-6" />
                    ) : (
                      <MetricChart metric={m} points={points} height={160} />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
      <LatestWellness athlete={athlete} />
    </div>
  );
}

function LatestWellness({ athlete }: { athlete: Athlete }) {
  const forms = useForms();
  const questionnaires = (forms.data ?? []).filter((f) => f.kind === "questionnaire" && f.current_version);
  const subs = useSubmissions({ athlete_id: athlete.id, limit: 30 });
  const latestByForm = new Map<string, Submission>();
  for (const s of subs.data?.items ?? []) {
    if (!latestByForm.has(s.form_id)) latestByForm.set(s.form_id, s);
  }
  const shown = questionnaires.filter((f) => latestByForm.has(f.id)).slice(0, 3);

  return (
    <section aria-labelledby="wellness-h" className="grid content-start gap-3">
      <h2 id="wellness-h" className="text-sm font-semibold">
        Latest questionnaires
      </h2>
      {subs.isPending || forms.isPending ? (
        <Skeleton className="h-64" />
      ) : shown.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No questionnaire submissions yet.</CardContent>
        </Card>
      ) : (
        shown.map((f) => <SubmissionSummaryCard key={f.id} form={f} submission={latestByForm.get(f.id)!} />)
      )}
    </section>
  );
}

function SubmissionSummaryCard({ form, submission }: { form: Form; submission: Submission }) {
  const fields = valueFields(form.current_version?.schema);
  return (
    <Card>
      <CardHeader className="py-2.5">
        <CardTitle className="truncate">{form.name}</CardTitle>
        <CardDescription>{formatDate(submission.local_date)}</CardDescription>
      </CardHeader>
      <CardContent className="py-2">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          {fields.map((f) => {
            const v = f.type === "calculated" ? submission.computed[f.key] : submission.values[f.key];
            const text = formatFieldValue(f, v);
            if (text === EMPTY_TEXT && f.type !== "calculated") return null;
            return (
              <div key={f.key} className="contents">
                <dt className={cn("truncate text-muted-foreground", f.type === "calculated" && "font-medium text-foreground")}>{f.label}</dt>
                <dd className={cn("text-right tabular", f.type === "calculated" && "font-semibold")}>{text}</dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}
