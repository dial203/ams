import { DEFAULT_TERMINOLOGY, queryKeys, type Me, type Organization, type OrganizationUpdate, type Terminology } from "@ams/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FormRow } from "@/components/FormRow";
import { Spinner } from "@/components/states";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useApi } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { sameJson } from "@/lib/json";
import { useOrg } from "@/lib/org";
import { useMetrics } from "@/lib/queries";

const PRESETS: { label: string; t: Terminology }[] = [
  { label: "Sport", t: { athlete: "Athlete", athletes: "Athletes", group: "Group", groups: "Groups" } },
  { label: "Tactical", t: { athlete: "Operator", athletes: "Operators", group: "Unit", groups: "Units" } },
  { label: "Research", t: { athlete: "Participant", athletes: "Participants", group: "Cohort", groups: "Cohorts" } },
];

interface Draft {
  name: string;
  timezone: string;
  terminology: Terminology;
  readiness: string[];
}

function fromOrg(org: Organization): Draft {
  return {
    name: org.name,
    timezone: org.timezone,
    terminology: { ...DEFAULT_TERMINOLOGY, ...(org.settings.terminology ?? {}) },
    readiness: [...(org.settings.readiness_metrics ?? [])],
  };
}

export function OrganizationSettings() {
  const api = useApi();
  const qc = useQueryClient();
  const { org, orgId, isAdmin } = useOrg();
  const metrics = useMetrics();
  const [d, setD] = useState<Draft>(() => fromOrg(org));
  const original = fromOrg(org);
  const dirty = !sameJson(d, original);
  const [adding, setAdding] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const body: OrganizationUpdate = {
        name: d.name.trim(),
        timezone: d.timezone,
        settings: { terminology: d.terminology, readiness_metrics: d.readiness },
      };
      return api.orgs.update(orgId, body);
    },
    onSuccess: (o) => {
      qc.setQueryData(queryKeys.orgs.detail(orgId), o);
      qc.setQueryData<Me>(queryKeys.me(), (me) => (me ? { ...me, memberships: me.memberships.map((m) => (m.org.id === o.id ? { ...m, org: o } : m)) } : me));
      void qc.invalidateQueries({ queryKey: queryKeys.dashboards.all(orgId) });
      setD(fromOrg(o));
      toast.success("Organization settings saved");
    },
    onError: (e) => toastError(e, "Could not save"),
  });

  const metricName = (slug: string) => metrics.data?.find((m) => m.slug === slug)?.name;
  const available = (metrics.data ?? []).filter((m) => !d.readiness.includes(m.slug));
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= d.readiness.length) return;
    const next = d.readiness.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    setD({ ...d, readiness: next });
  };
  const setTerm = (k: keyof Terminology, v: string) => setD({ ...d, terminology: { ...d.terminology, [k]: v } });

  return (
    <fieldset disabled={!isAdmin} className="grid max-w-4xl gap-4">
      {!isAdmin && <p className="text-sm text-muted-foreground">Only owners and admins can change organization settings.</p>}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>General</CardTitle>
            <CardDescription>The time zone decides which calendar day a submission belongs to when a person has none set.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 py-4 sm:grid-cols-2">
          <FormRow label="Name" htmlFor="org-name">
            <Input id="org-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          </FormRow>
          <FormRow label="Time zone" htmlFor="org-tz">
            <TimezoneSelect id="org-tz" value={d.timezone} onValueChange={(v) => setD({ ...d, timezone: v ?? "UTC" })} />
          </FormRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Terminology</CardTitle>
            <CardDescription>What the app calls the people and groups you work with.</CardDescription>
          </div>
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <Button key={p.label} type="button" variant="outline" size="sm" onClick={() => setD({ ...d, terminology: p.t })}>
                {p.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 py-4 sm:grid-cols-4">
          {(["athlete", "athletes", "group", "groups"] as const).map((k) => (
            <FormRow key={k} label={k === "athlete" ? "Person (one)" : k === "athletes" ? "People (many)" : k === "group" ? "Group (one)" : "Groups (many)"} htmlFor={`term-${k}`}>
              <Input id={`term-${k}`} value={d.terminology[k]} placeholder={DEFAULT_TERMINOLOGY[k]} onChange={(e) => setTerm(k, e.target.value)} />
            </FormRow>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Readiness board</CardTitle>
            <CardDescription>Metrics shown as columns, in this order. Flags come from each metric’s thresholds.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 py-4">
          {d.readiness.length === 0 ? (
            <p className="text-sm text-muted-foreground">No metrics selected; the board will be empty.</p>
          ) : (
            <ol className="grid gap-1" aria-label="Readiness metrics in order">
              {d.readiness.map((slug, i) => (
                <li key={slug} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
                  <span className="w-5 text-xs text-muted-foreground tabular">{i + 1}</span>
                  <span className="flex-1 truncate text-sm">
                    {metricName(slug) ?? <span className="text-destructive">Unknown metric</span>}{" "}
                    <code className="ml-1 font-mono text-[11px] text-muted-foreground">{slug}</code>
                  </span>
                  {metrics.data?.find((m) => m.slug === slug)?.thresholds ? <Badge variant="muted">flags</Badge> : null}
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${slug} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${slug} down`} onClick={() => move(i, 1)} disabled={i === d.readiness.length - 1}>
                    <ArrowDown />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${slug}`} onClick={() => setD({ ...d, readiness: d.readiness.filter((s) => s !== slug) })}>
                    <X />
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <div className="flex max-w-md gap-2">
            <NativeSelect aria-label="Metric to add" value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Add a metric…</option>
              {available.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
            <Button
              type="button"
              variant="outline"
              disabled={!adding}
              onClick={() => {
                setD({ ...d, readiness: [...d.readiness, adding] });
                setAdding("");
              }}
            >
              <Plus /> Add
            </Button>
          </div>
        </CardContent>
      </Card>
      {isAdmin && (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur">
          {dirty && <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>}
          <Button variant="ghost" type="button" disabled={!dirty} onClick={() => setD(original)}>
            Reset
          </Button>
          <Button type="button" disabled={!dirty || !d.name.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner className="text-current" />}
            Save organization settings
          </Button>
        </div>
      )}
    </fieldset>
  );
}
