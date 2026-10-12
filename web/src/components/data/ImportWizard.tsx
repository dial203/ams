import { queryKeys, type Form, type ImportBatch, type ImportCommit, type ImportPreview } from "@ams/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { initialMapping, type MappingState } from "@/components/data/import-logic";
import { MappingStep } from "@/components/data/MappingStep";
import { Spinner } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/lib/api-context";
import { errorText, toastError } from "@/lib/errors";
import { useOrg } from "@/lib/org";
import { publishedForms, useForms } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Step = "form" | "upload" | "map" | "dry" | "done";
const STEPS: { id: Step; label: string }[] = [
  { id: "form", label: "Form" },
  { id: "upload", label: "File" },
  { id: "map", label: "Mapping" },
  { id: "dry", label: "Check" },
  { id: "done", label: "Import" },
];

export function ImportWizard({ onViewHistory }: { onViewHistory(): void }) {
  const api = useApi();
  const qc = useQueryClient();
  const { orgId, today, timezone, terms } = useOrg();
  const forms = useForms();
  const available = publishedForms(forms.data);
  const [step, setStep] = useState<Step>("form");
  const [formId, setFormId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<MappingState | null>(null);
  const [commit, setCommit] = useState<Omit<ImportCommit, "upload_id" | "dry_run"> | null>(null);
  const [dry, setDry] = useState<ImportBatch | null>(null);
  const [result, setResult] = useState<ImportBatch | null>(null);
  const form: Form | undefined = available.find((f) => f.id === formId);
  const schema = form?.current_version?.schema;

  const upload = useMutation({
    mutationFn: (f: File) => api.imports.preview(orgId, formId, f),
    onSuccess: (p) => {
      setPreview(p);
      setMapping(initialMapping(p, schema!, { today, timezone }));
      setStep("map");
    },
    onError: (e) => toastError(e, "Could not read the file"),
  });
  const run = useMutation({
    mutationFn: (body: ImportCommit) => api.imports.commit(orgId, formId, body),
    onSuccess: (batch) => {
      if (batch.dry_run) {
        setDry(batch);
        setStep("dry");
      } else {
        setResult(batch);
        setStep("done");
        void qc.invalidateQueries({ queryKey: queryKeys.imports.all(orgId) });
        void qc.invalidateQueries({ queryKey: queryKeys.submissions.all(orgId) });
        void qc.invalidateQueries({ queryKey: queryKeys.dashboards.all(orgId) });
        void qc.invalidateQueries({ queryKey: queryKeys.metrics.allSeries(orgId) });
        toast.success(`Imported ${batch.created_count} submission${batch.created_count === 1 ? "" : "s"}`);
      }
    },
    onError: (e) => toastError(e, "Import failed"),
  });

  const reset = () => {
    setStep("form");
    setFile(null);
    setPreview(null);
    setMapping(null);
    setCommit(null);
    setDry(null);
    setResult(null);
  };
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="grid max-w-5xl gap-5">
      <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2" aria-current={s.id === step ? "step" : undefined}>
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold tabular",
                i < stepIndex && "border-flag-green bg-flag-green text-white",
                i === stepIndex && "border-foreground bg-foreground text-background",
                i > stepIndex && "text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <span className={cn(i === stepIndex ? "font-medium" : "text-muted-foreground")}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      {step === "form" && (
        <Card>
          <CardContent className="grid gap-4 py-5">
            <div className="grid max-w-md gap-1.5">
              <label htmlFor="imp-form" className="text-[13px] font-medium">
                Which form do the rows belong to?
              </label>
              <NativeSelect id="imp-form" value={formId} onChange={(e) => setFormId(e.target.value)} disabled={forms.isPending}>
                <option value="">Choose a form…</option>
                {available.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                One row becomes one submission, validated against the form’s published version. Calculated fields are recomputed.
              </p>
            </div>
            <div>
              <Button onClick={() => setStep("upload")} disabled={!form}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "upload" && form && (
        <Card>
          <CardContent className="grid gap-4 py-5">
            <FileDrop
              file={file}
              onFile={(f) => {
                setFile(f);
                upload.mutate(f);
              }}
              busy={upload.isPending}
            />
            {upload.isError && <p className="text-sm text-destructive">{errorText(upload.error)}</p>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("form")}>
                Back
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "map" && preview && mapping && schema && (
        <MappingStep
          preview={preview}
          schema={schema}
          state={mapping}
          onStateChange={setMapping}
          athleteTerm={terms.athlete}
          busy={run.isPending}
          onBack={() => setStep("upload")}
          onSubmit={(c) => {
            setCommit(c);
            run.mutate({ ...c, upload_id: preview.upload_id, dry_run: true });
          }}
        />
      )}

      {step === "dry" && dry && preview && commit && (
        <div className="grid gap-4">
          <BatchSummary batch={dry} dryRun />
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setStep("map")}>
              Back to mapping
            </Button>
            <Button onClick={() => run.mutate({ ...commit, upload_id: preview.upload_id, dry_run: false })} disabled={run.isPending || dry.created_count === 0}>
              {run.isPending && <Spinner className="text-current" />}
              Import {dry.created_count} row{dry.created_count === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="grid gap-4">
          <BatchSummary batch={result} />
          <div className="flex gap-2">
            <Button onClick={reset}>Import another file</Button>
            <Button variant="outline" onClick={onViewHistory}>
              Import history
            </Button>
          </div>
        </div>
      )}
      {run.isPending && step === "map" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Checking every row…
        </p>
      )}
    </div>
  );
}

function FileDrop({ file, onFile, busy }: { file: File | null; onFile(f: File): void; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const accept = (f: File | undefined) => {
    if (!f) return;
    if (!/\.(csv|xlsx)$/i.test(f.name)) {
      toast.error("Use a .csv or .xlsx file");
      return;
    }
    onFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    accept(e.dataTransfer.files[0]);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
        over ? "border-brand bg-brand/5" : "border-border",
      )}
    >
      {busy ? <Spinner className="size-5" /> : <FileSpreadsheet aria-hidden className="size-6 text-muted-foreground" />}
      <div className="text-sm font-medium">{busy ? `Reading ${file?.name ?? "file"}…` : "Drop a CSV or Excel file here"}</div>
      <div className="text-xs text-muted-foreground">Exports from GPS, force-plate or team systems work as they are; you map the columns next.</div>
      <input
        ref={input}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        aria-label="Choose file"
        onChange={(e) => accept(e.target.files?.[0])}
      />
      <Button variant="outline" size="sm" className="mt-1" onClick={() => input.current?.click()} disabled={busy}>
        <Upload /> Choose file
      </Button>
    </div>
  );
}

export function BatchSummary({ batch, dryRun = false }: { batch: ImportBatch; dryRun?: boolean }) {
  const ok = batch.errors.length === 0;
  return (
    <div className="grid gap-3">
      <Alert variant={ok ? "info" : "warning"}>
        {ok ? <CircleCheck /> : <TriangleAlert />}
        <AlertTitle>
          {dryRun ? "Dry run: " : ""}
          {batch.created_count} of {batch.row_count} row{batch.row_count === 1 ? "" : "s"} {dryRun ? "would be imported" : "imported"}
          {batch.skipped_count > 0 && `, ${batch.skipped_count} skipped`}
        </AlertTitle>
        <AlertDescription>
          {dryRun ? "Nothing has been saved yet." : `File ${batch.filename}. You can roll the whole batch back from the import history.`}
        </AlertDescription>
      </Alert>
      <div className="grid grid-cols-3 gap-2 sm:max-w-md">
        <Stat label="Rows" value={batch.row_count} />
        <Stat label={dryRun ? "Would create" : "Created"} value={batch.created_count} tone="text-flag-green" />
        <Stat label="Skipped" value={batch.skipped_count} tone={batch.skipped_count ? "text-flag-amber" : undefined} />
      </div>
      {batch.errors.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-20">Row</TableHead>
                  <TableHead>Problem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batch.errors.map((e, i) => (
                  <TableRow key={i}>
                    <TableCell className="tabular">{e.row}</TableCell>
                    <TableCell className="whitespace-normal text-destructive">{e.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string | undefined }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular", value > 0 && tone)}>{value}</div>
    </div>
  );
}
