import { valueFields, type Athlete, type Submission } from "@ams/shared";
import { Link } from "@tanstack/react-router";
import { Database, Plus } from "lucide-react";
import { useState } from "react";
import { Pagination } from "@/components/Pagination";
import { EmptyState, ErrorState, Spinner } from "@/components/states";
import { SubmissionSheet } from "@/components/submissions/SubmissionSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCellValue, formatDate } from "@/lib/field-format";
import { SOURCE_LABELS } from "@/lib/labels";
import { useForms, useSubmissions } from "@/lib/queries";

const PAGE = 25;

export function DataTab({ athlete }: { athlete: Athlete }) {
  const forms = useForms();
  const [formId, setFormId] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Submission | null>(null);
  const subs = useSubmissions({ athlete_id: athlete.id, form_id: formId || null, limit: PAGE, offset });
  const formById = new Map((forms.data ?? []).map((f) => [f.id, f]));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label="Filter by form"
          size="sm"
          wrapperClassName="w-60"
          value={formId}
          onChange={(e) => {
            setFormId(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All forms</option>
          {(forms.data ?? []).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </NativeSelect>
        {subs.isFetching && <Spinner />}
        <Button asChild size="sm" variant="outline" className="ml-auto">
          <Link to="/entry" search={{ athlete: athlete.id, form: formId || undefined }}>
            <Plus /> Enter data
          </Link>
        </Button>
        {subs.data && <Pagination offset={offset} limit={PAGE} total={subs.data.total} onChange={setOffset} />}
      </div>
      {subs.isPending ? (
        <Skeleton className="h-64" />
      ) : subs.isError ? (
        <ErrorState error={subs.error} onRetry={() => void subs.refetch()} />
      ) : subs.data.items.length === 0 ? (
        <EmptyState icon={Database} title="No submissions" description="Nothing recorded for this filter yet." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Day</TableHead>
                <TableHead>Form</TableHead>
                <TableHead>Values</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Version</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.data.items.map((s) => {
                const form = formById.get(s.form_id);
                const fields = valueFields(form?.current_version?.schema);
                const preview = fields
                  .map((f) => {
                    const v = f.type === "calculated" ? s.computed[f.key] : s.values[f.key];
                    const text = formatCellValue(f, v);
                    return text ? `${f.label}: ${text}` : null;
                  })
                  .filter(Boolean)
                  .slice(0, 4)
                  .join(" · ");
                return (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpen(s)}>
                    <TableCell className="tabular">
                      <button type="button" className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" onClick={(e) => { e.stopPropagation(); setOpen(s); }}>
                        {formatDate(s.local_date)}
                      </button>
                    </TableCell>
                    <TableCell className="font-medium">{form?.name ?? "Unknown form"}</TableCell>
                    <TableCell className="max-w-[28rem] truncate text-muted-foreground">{preview || "–"}</TableCell>
                    <TableCell>
                      <Badge variant="muted">{SOURCE_LABELS[s.source]}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular">v{s.form_version}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <SubmissionSheet submission={open} form={open ? formById.get(open.form_id) : undefined} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  );
}
