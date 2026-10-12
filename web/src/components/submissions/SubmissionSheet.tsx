import { isApiError, queryKeys, type Form, type FormSchema, type Submission } from "@ams/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormRenderer } from "@/components/forms/FormRenderer";
import { ErrorState, Spinner } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useApi } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/field-format";
import { SOURCE_LABELS } from "@/lib/labels";
import { useOrg } from "@/lib/org";
import { useFormVersions } from "@/lib/queries";

/** Side sheet that renders a submission with its own form version; edit (PATCH) and delete. */
export function SubmissionSheet({
  submission,
  form,
  onOpenChange,
  startEditing = false,
}: {
  submission: Submission | null;
  form: Form | undefined;
  onOpenChange(open: boolean): void;
  startEditing?: boolean;
}) {
  return (
    <Sheet open={!!submission} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 sm:max-w-xl">
        {submission && (
          <SubmissionSheetBody
            key={submission.id}
            submission={submission}
            form={form}
            onClose={() => onOpenChange(false)}
            startEditing={startEditing}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SubmissionSheetBody({
  submission,
  form,
  onClose,
  startEditing,
}: {
  submission: Submission;
  form: Form | undefined;
  onClose(): void;
  startEditing: boolean;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId } = useOrg();
  const [editing, setEditing] = useState(startEditing);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [localDate, setLocalDate] = useState(submission.local_date);
  const [serverErrors, setServerErrors] = useState<Record<string, string> | null>(null);
  const versions = useFormVersions(submission.form_id);

  let schema: FormSchema | undefined;
  if (form?.current_version?.id === submission.form_version_id) schema = form.current_version.schema;
  else schema = versions.data?.find((v) => v.id === submission.form_version_id)?.schema;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.submissions.all(orgId) });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboards.all(orgId) });
    void qc.invalidateQueries({ queryKey: queryKeys.metrics.allSeries(orgId) });
  };

  const update = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api.submissions.update(orgId, submission.id, {
        values,
        ...(localDate !== submission.local_date ? { local_date: localDate } : {}),
      }),
    onSuccess: () => {
      toast.success("Submission updated");
      setServerErrors(null);
      invalidate();
      onClose();
    },
    onError: (e) => {
      if (isApiError(e) && e.fieldErrors) {
        setServerErrors(e.fieldErrors);
        toast.error("Some values were rejected", { description: e.detail });
      } else toastError(e, "Could not save");
    },
  });

  const remove = async () => {
    try {
      await api.submissions.delete(orgId, submission.id);
      toast.success("Submission deleted");
      invalidate();
      onClose();
    } catch (e) {
      toastError(e, "Could not delete");
      throw e;
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>{form?.name ?? "Submission"}</SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{submission.athlete_display_name}</span>
            <span aria-hidden>·</span>
            <span>{formatDate(submission.local_date)}</span>
            <Badge variant="muted">{SOURCE_LABELS[submission.source]}</Badge>
            <Badge variant="outline">v{submission.form_version}</Badge>
          </div>
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">
        {!schema ? (
          versions.isError ? (
            <ErrorState error={versions.error} title="Could not load the form version" />
          ) : (
            <Spinner />
          )
        ) : editing ? (
          <div className="grid gap-5">
            <label className="grid w-fit gap-1.5 text-[13px] font-medium">
              Day
              <Input type="date" value={localDate} onChange={(e) => setLocalDate(e.target.value)} className="w-44" />
            </label>
            <FormRenderer
              schema={schema}
              initialValues={submission.values}
              serverErrors={serverErrors}
              onSubmit={(r) => update.mutate(r.values)}
              busy={update.isPending}
              submitLabel="Save changes"
              compact
              actions={
                <Button variant="ghost" onClick={() => setEditing(false)} disabled={update.isPending}>
                  Cancel
                </Button>
              }
            />
          </div>
        ) : (
          <FormRenderer schema={schema} initialValues={submission.values} readOnly compact />
        )}
      </div>
      {!editing && (
        <div className="flex items-center gap-2 border-t p-3">
          <Button size="sm" onClick={() => setEditing(true)} disabled={!schema}>
            <Pencil /> Edit
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <span className="ml-auto text-xs text-muted-foreground" title={submission.observed_at}>
            Observed {formatDateTime(submission.observed_at)}
          </span>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this submission?"
        description="It disappears from boards, metrics and exports. The deletion is recorded in the audit log."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </>
  );
}
