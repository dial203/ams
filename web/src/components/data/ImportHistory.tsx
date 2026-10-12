import { queryKeys, type ImportBatch } from "@ams/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Undo2 } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { useOrg } from "@/lib/org";
import { useForms, useMembers } from "@/lib/queries";

export function ImportHistory({ formId }: { formId: string | null }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, isAdmin } = useOrg();
  const [showDry, setShowDry] = useState(false);
  const [rollback, setRollback] = useState<ImportBatch | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const forms = useForms({ include_archived: true });
  const members = useMembers();
  const params = { form_id: formId };
  const batches = useQuery({
    queryKey: queryKeys.imports.list(orgId, params),
    queryFn: ({ signal }) => api.imports.list(orgId, params, { signal }),
  });
  const formName = (id: string) => forms.data?.find((f) => f.id === id)?.name ?? "Unknown form";
  const userName = (id: string) => {
    const m = members.data?.find((x) => x.user.id === id);
    return m ? m.user.full_name || m.user.email : "–";
  };
  const rows = (batches.data ?? []).filter((b) => showDry || !b.dry_run);

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Rolling back soft-deletes every submission the batch created. It is audited and can be redone by importing again.</p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showDry} onCheckedChange={setShowDry} /> Show dry runs
        </label>
      </div>
      {batches.isPending ? (
        <Skeleton className="h-48" />
      ) : batches.isError ? (
        <ErrorState error={batches.error} onRetry={() => void batches.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={History} title="No imports yet" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>When</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Form</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => (
                <Fragment key={b.id}>
                  <TableRow>
                    <TableCell className="text-muted-foreground tabular">{new Date(b.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                    <TableCell className="max-w-56 truncate font-medium">
                      {b.filename} {b.dry_run && <Badge variant="muted">Dry run</Badge>}
                    </TableCell>
                    <TableCell>{formName(b.form_id)}</TableCell>
                    <TableCell className="text-muted-foreground">{userName(b.created_by)}</TableCell>
                    <TableCell className="text-right tabular">{b.row_count}</TableCell>
                    <TableCell className="text-right tabular">{b.created_count}</TableCell>
                    <TableCell className="text-right tabular">
                      {b.skipped_count > 0 ? (
                        <button type="button" className="text-flag-amber underline-offset-2 hover:underline" onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
                          {b.skipped_count}
                        </button>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isAdmin && !b.dry_run && b.created_count > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setRollback(b)}>
                          <Undo2 /> Roll back
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {expanded === b.id && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={8} className="bg-muted/30 whitespace-normal">
                        <ul className="grid gap-0.5 text-xs">
                          {b.errors.map((e, i) => (
                            <li key={i}>
                              <span className="tabular text-muted-foreground">Row {e.row}:</span> {e.message}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <ConfirmDialog
        open={!!rollback}
        onOpenChange={(o) => !o && setRollback(null)}
        title={`Roll back ${rollback?.filename ?? "import"}?`}
        description={`${rollback?.created_count ?? 0} submissions from this batch will be deleted (soft delete, audited).`}
        confirmLabel="Roll back"
        destructive
        onConfirm={async () => {
          try {
            await api.imports.delete(orgId, rollback!.id);
            void qc.invalidateQueries({ queryKey: queryKeys.imports.all(orgId) });
            void qc.invalidateQueries({ queryKey: queryKeys.submissions.all(orgId) });
            void qc.invalidateQueries({ queryKey: queryKeys.dashboards.all(orgId) });
            toast.success("Import rolled back");
          } catch (e) {
            toastError(e, "Could not roll back");
            throw e;
          }
        }}
      />
    </div>
  );
}
