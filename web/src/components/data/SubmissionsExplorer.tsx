import { SUBMISSION_SOURCES, valueFields, type Submission, type SubmissionSource } from "@ams/shared";
import { Database, Download, EyeOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AthletePicker } from "@/components/AthletePicker";
import { Pagination } from "@/components/Pagination";
import { EmptyState, ErrorState, Spinner } from "@/components/states";
import { SubmissionSheet } from "@/components/submissions/SubmissionSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/lib/api-context";
import { downloadText } from "@/lib/download";
import { toastError } from "@/lib/errors";
import { formatCellValue, formatDate } from "@/lib/field-format";
import { SOURCE_LABELS } from "@/lib/labels";
import { useOrg } from "@/lib/org";
import { useForms, useGroups, useSubmissions } from "@/lib/queries";
import { cn } from "@/lib/utils";

const PAGE = 50;
const NUMERIC = new Set(["number", "scale", "duration", "calculated"]);

export interface ExplorerFilters {
  formId: string | null;
  athleteId: string | null;
  start: string;
  end: string;
  source: SubmissionSource | null;
}

export function SubmissionsExplorer({ filters, onFiltersChange }: { filters: ExplorerFilters; onFiltersChange(f: ExplorerFilters): void }) {
  const api = useApi();
  const { orgId, groupId, terms } = useOrg();
  const forms = useForms({ include_archived: true });
  const groups = useGroups();
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Submission | null>(null);
  const [deidentified, setDeidentified] = useState(false);
  const [exporting, setExporting] = useState(false);
  const set = (patch: Partial<ExplorerFilters>) => {
    setOffset(0);
    onFiltersChange({ ...filters, ...patch });
  };
  const form = forms.data?.find((f) => f.id === filters.formId);
  const fields = valueFields(form?.current_version?.schema ?? form?.draft_schema);
  const subs = useSubmissions({
    form_id: filters.formId,
    athlete_id: filters.athleteId,
    group_id: groupId,
    start: filters.start || null,
    end: filters.end || null,
    source: filters.source,
    limit: PAGE,
    offset,
  });
  const formName = (id: string) => forms.data?.find((f) => f.id === id)?.name ?? "–";
  const groupName = groups.data?.find((g) => g.id === groupId)?.name;

  const exportCsv = async () => {
    if (!form) return;
    setExporting(true);
    try {
      const csv = await api.submissions.exportCsv(orgId, {
        form_id: form.id,
        group_id: groupId,
        start: filters.start || null,
        end: filters.end || null,
        deidentified,
      });
      const name = `${form.slug}_${filters.start || "all"}_${filters.end || "all"}${deidentified ? "_deidentified" : ""}.csv`;
      downloadText(csv, name);
      toast.success("Export ready", { description: name });
    } catch (e) {
      toastError(e, "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="ex-form" className="text-xs text-muted-foreground">
            Form
          </Label>
          <NativeSelect id="ex-form" size="sm" wrapperClassName="w-56" value={filters.formId ?? ""} onChange={(e) => set({ formId: e.target.value || null })}>
            <option value="">All forms</option>
            {(forms.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">{terms.athlete}</Label>
          <AthletePicker value={filters.athleteId} onChange={(id) => set({ athleteId: id })} allowClear size="sm" className="w-56" placeholder={`All ${terms.athletes.toLowerCase()}`} aria-label={`${terms.athlete} filter`} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ex-start" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input id="ex-start" type="date" value={filters.start} onChange={(e) => set({ start: e.target.value })} className="h-7 w-36 text-xs" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ex-end" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input id="ex-end" type="date" value={filters.end} onChange={(e) => set({ end: e.target.value })} className="h-7 w-36 text-xs" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ex-source" className="text-xs text-muted-foreground">
            Source
          </Label>
          <NativeSelect id="ex-source" size="sm" wrapperClassName="w-28" value={filters.source ?? ""} onChange={(e) => set({ source: (e.target.value || null) as SubmissionSource | null })}>
            <option value="">Any</option>
            {SUBMISSION_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {subs.isFetching && <Spinner />}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" disabled={!form} title={form ? undefined : "Choose a form to export"}>
                <Download /> Export CSV
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="grid w-72 gap-3">
              <div className="text-sm font-medium">Export {form?.name}</div>
              <p className="text-xs text-muted-foreground">
                One row per submission{groupName ? ` in ${groupName}` : ""}
                {filters.start || filters.end ? `, ${filters.start || "…"} to ${filters.end || "…"}` : ""}, with every field and calculated value.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <Switch checked={deidentified} onCheckedChange={setDeidentified} className="mt-0.5" />
                <span>
                  De-identified
                  <span className="block text-xs text-muted-foreground">Codes only, no names. Masked people are always exported by code.</span>
                </span>
              </label>
              <Button size="sm" onClick={() => void exportCsv()} disabled={exporting}>
                {exporting ? <Spinner className="text-current" /> : deidentified ? <EyeOff /> : <Download />}
                Download
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {subs.isPending ? (
        <Skeleton className="h-72" />
      ) : subs.isError ? (
        <ErrorState error={subs.error} onRetry={() => void subs.refetch()} />
      ) : subs.data.items.length === 0 ? (
        <EmptyState icon={Database} title="No submissions match" description="Widen the date range or clear filters." />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="max-h-[calc(100dvh-19rem)] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {["Day", terms.athlete, ...(form ? [] : ["Form"]), "Source", "Ver."].map((h, i) => (
                    <th key={h} className={cn("sticky top-0 z-10 border-b bg-muted px-3 py-1.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground", i === 1 && "left-0 z-20")}>
                      {h}
                    </th>
                  ))}
                  {form &&
                    fields.map((f) => (
                      <th key={f.key} title={f.key} className={cn("sticky top-0 z-10 max-w-40 border-b border-l bg-muted px-2 py-1.5 text-xs font-medium whitespace-nowrap", NUMERIC.has(f.type) ? "text-right" : "text-left", f.type === "calculated" ? "text-muted-foreground italic" : "text-foreground")}>
                        <span className="block truncate">{f.label}</span>
                      </th>
                    ))}
                  {!form && <th className="sticky top-0 z-10 border-b bg-muted px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">Values</th>}
                </tr>
              </thead>
              <tbody>
                {subs.data.items.map((s) => (
                  <tr key={s.id} className="group cursor-pointer hover:bg-muted/40" onClick={() => setOpen(s)}>
                    <td className="border-b px-3 py-1.5 whitespace-nowrap tabular">
                      <button type="button" className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" onClick={(e) => { e.stopPropagation(); setOpen(s); }}>
                        {formatDate(s.local_date)}
                      </button>
                    </td>
                    <td className="sticky left-0 border-b bg-background px-3 py-1.5 font-medium whitespace-nowrap group-hover:bg-muted">{s.athlete_display_name}</td>
                    {!form && <td className="border-b px-3 py-1.5 whitespace-nowrap">{formName(s.form_id)}</td>}
                    <td className="border-b px-3 py-1.5">
                      <Badge variant="muted">{SOURCE_LABELS[s.source]}</Badge>
                    </td>
                    <td className="border-b px-3 py-1.5 text-muted-foreground tabular">v{s.form_version}</td>
                    {form &&
                      fields.map((f) => (
                        <td key={f.key} className={cn("max-w-48 truncate border-b border-l px-2 py-1.5 tabular", NUMERIC.has(f.type) ? "text-right" : "text-left", f.type === "calculated" && "bg-muted/30 text-muted-foreground")}>
                          {formatCellValue(f, f.type === "calculated" ? s.computed[f.key] : s.values[f.key])}
                        </td>
                      ))}
                    {!form && (
                      <td className="max-w-96 truncate border-b px-3 py-1.5 text-xs text-muted-foreground">
                        {Object.entries({ ...s.values, ...s.computed })
                          .slice(0, 5)
                          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                          .join(" · ")}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t px-3 py-2">
            <span className="text-xs text-muted-foreground">Newest first. Columns follow the form’s latest version.</span>
            <Pagination offset={offset} limit={PAGE} total={subs.data.total} onChange={setOffset} />
          </div>
        </div>
      )}
      <SubmissionSheet submission={open} form={open ? forms.data?.find((f) => f.id === open.form_id) : undefined} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  );
}
