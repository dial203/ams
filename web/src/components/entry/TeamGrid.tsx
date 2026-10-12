/**
 * Spreadsheet-style team entry: one row per athlete, one column per input field of the
 * form's published version. Tab / Shift+Tab move across, Enter / Shift+Enter and the arrow
 * keys move between rows, pasting a block from a spreadsheet fills cells. Calculated
 * columns update live with the shared engine; "Save all" posts `submissions/bulk`.
 */
import {
  compileForm,
  errorMessage,
  inputFields,
  allFields,
  isApiError,
  type BulkSubmissionCreate,
  type BulkSubmissionResult,
  type Field,
  type Form,
  type FormSchema,
  type FormValues,
  type InputField,
  type Submission,
} from "@ams/shared";
import { CircleCheck, CircleAlert, Info, Save, Undo2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { GridCell } from "@/components/entry/GridCells";
import { isGridPaste, isRowEmpty, parseCellText, parseClipboard, prepareBulkSave } from "@/components/entry/grid-logic";
import { Spinner } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorText } from "@/lib/errors";
import { formatFieldValue, rangeHint } from "@/lib/field-format";
import { cn } from "@/lib/utils";

export interface GridAthlete {
  id: string;
  label: string;
  sublabel?: string;
}

export interface TeamGridProps {
  form: Pick<Form, "id" | "name" | "allow_multiple_per_day">;
  schema: FormSchema;
  athletes: readonly GridAthlete[];
  date: string;
  /** Submissions already recorded for this form and day, by athlete id. */
  existing?: ReadonlyMap<string, readonly Submission[]>;
  onSave(payload: BulkSubmissionCreate): Promise<BulkSubmissionResult>;
  onOpenSubmission?(submission: Submission): void;
  /** Reports unsaved rows so the page can warn before leaving. */
  onDirtyChange?(dirty: boolean): void;
}

type Column = { kind: "input"; field: InputField; index: number } | { kind: "calc"; field: Field };

const NAV_KEYS = new Set(["Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const EMPTY_VALUES: FormValues = Object.freeze({}) as FormValues;

export function TeamGrid({ form, schema, athletes, date, existing, onSave, onOpenSubmission, onDirtyChange }: TeamGridProps) {
  const compiled = useMemo(() => compileForm(schema), [schema]);
  const columns = useMemo<Column[]>(() => {
    let i = 0;
    return allFields(schema)
      .map((l) => l.field)
      .filter((f) => f.type !== "info")
      .map((f) => (f.type === "calculated" ? { kind: "calc" as const, field: f } : { kind: "input" as const, field: f as InputField, index: i++ }));
  }, [schema]);
  const inputCount = useMemo(() => inputFields(schema).length, [schema]);

  const [rows, setRows] = useState<Record<string, FormValues>>({});
  const [saved, setSaved] = useState<Record<string, Submission>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, Record<string, string>>>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  /** Rows locked because the form allows one submission per day and one exists. */
  const locked = useMemo(() => {
    const out = new Map<string, Submission>();
    if (!form.allow_multiple_per_day && existing) {
      for (const [id, subs] of existing) if (subs.length > 0) out.set(id, subs[0]!);
    }
    for (const [id, sub] of Object.entries(saved)) if (!form.allow_multiple_per_day) out.set(id, sub);
    return out;
  }, [existing, saved, form.allow_multiple_per_day]);

  const onChange = useCallback((athleteId: string, key: string, value: unknown) => {
    setRows((prev) => {
      const row = { ...(prev[athleteId] ?? {}) };
      if (value === undefined) delete row[key];
      else row[key] = value;
      return { ...prev, [athleteId]: row };
    });
    setServerErrors((prev) => {
      if (!prev[athleteId]?.[key]) return prev;
      const { [key]: _drop, ...rest } = prev[athleteId]!;
      return { ...prev, [athleteId]: rest };
    });
  }, []);

  const onBlur = useCallback((athleteId: string, key: string) => {
    setTouched((prev) => {
      const k = `${athleteId}:${key}`;
      if (prev.has(k)) return prev;
      const next = new Set(prev);
      next.add(k);
      return next;
    });
  }, []);

  const pending = athletes.filter((a) => !locked.has(a.id) && !saved[a.id] && !isRowEmpty(rows[a.id]));
  const invalidCount = pending.filter((a) => !compiled.validate(rows[a.id]).ok).length;

  useEffect(() => {
    onDirtyChange?.(pending.length > 0);
  }, [pending.length, onDirtyChange]);

  // ---- keyboard navigation
  const focusCell = (r: number, c: number): boolean => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`);
    if (!el || (el as HTMLInputElement).disabled) return false;
    el.focus();
    return true;
  };
  const move = (r: number, c: number, dr: number, dc: number) => {
    let nr = r + dr;
    let nc = c + dc;
    for (let guard = 0; guard < 500; guard++) {
      if (nr < 0 || nr >= athletes.length || nc < 0 || nc >= inputCount) return;
      if (focusCell(nr, nc)) return;
      nr += dr;
      nc += dc;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const pos = target.dataset.cell;
    if (!pos) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void saveAll();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      void saveAll();
      return;
    }
    if (!NAV_KEYS.has(e.key) || e.altKey) return;
    const [r, c] = pos.split(":").map(Number) as [number, number];
    const isText = target instanceof HTMLInputElement && !["date", "time", "datetime-local"].includes(target.type);
    if (e.key === "Enter") {
      e.preventDefault();
      move(r, c, e.shiftKey ? -1 : 1, 0);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(r, c, 1, 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(r, c, -1, 0);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (isText) {
        const input = target as HTMLInputElement;
        const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
        const atEnd = input.selectionStart === input.value.length;
        const allSelected = input.selectionStart === 0 && input.selectionEnd === input.value.length;
        if (e.key === "ArrowLeft" && !(atStart || allSelected)) return;
        if (e.key === "ArrowRight" && !(atEnd || allSelected)) return;
      } else if (target instanceof HTMLInputElement) {
        return; // date/time inputs use arrows for their segments
      }
      e.preventDefault();
      move(r, c, 0, e.key === "ArrowLeft" ? -1 : 1);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const pos = (e.target as HTMLElement).dataset.cell;
    const text = e.clipboardData.getData("text/plain");
    if (!pos || !isGridPaste(text)) return;
    e.preventDefault();
    const [r0, c0] = pos.split(":").map(Number) as [number, number];
    const block = parseClipboard(text);
    const inputs = columns.filter((c): c is Extract<Column, { kind: "input" }> => c.kind === "input");
    let filled = 0;
    setRows((prev) => {
      const next = { ...prev };
      block.forEach((cells, dr) => {
        const athlete = athletes[r0 + dr];
        if (!athlete || locked.has(athlete.id) || saved[athlete.id]) return;
        const row = { ...(next[athlete.id] ?? {}) };
        cells.forEach((cellText, dc) => {
          const col = inputs[c0 + dc];
          if (!col) return;
          const v = parseCellText(col.field, cellText);
          if (v === undefined) delete row[col.field.key];
          else row[col.field.key] = v;
          filled++;
        });
        next[athlete.id] = row;
      });
      return next;
    });
    setTimeout(() => filled && toast.success(`Pasted ${block.length} row${block.length === 1 ? "" : "s"}`), 0);
  };

  // ---- save
  const saveAll = async () => {
    if (saving) return;
    setAttempted(true);
    const skip = new Set<string>([...locked.keys(), ...Object.keys(saved)]);
    const prepared = prepareBulkSave(
      compiled,
      form.id,
      date,
      athletes.map((a) => ({ athleteId: a.id, values: rows[a.id] ?? {} })),
      skip,
    );
    if (!prepared.payload) {
      if (prepared.invalid.length) toast.error(`Fix ${prepared.invalid.length} row${prepared.invalid.length === 1 ? "" : "s"} with errors first`);
      else toast("Nothing to save");
      return;
    }
    setSaving(true);
    try {
      const result = await onSave(prepared.payload);
      const createdBy: Record<string, Submission> = {};
      for (const s of result.created) createdBy[s.athlete_id] = s;
      setSaved((prev) => ({ ...prev, ...createdBy }));
      const errs: Record<string, Record<string, string>> = {};
      for (const e of result.errors) errs[e.athlete_id] = e.field_errors;
      setServerErrors((prev) => ({ ...prev, ...errs }));
      const parts = [`Saved ${result.created.length}`];
      if (result.errors.length) parts.push(`${result.errors.length} rejected`);
      if (prepared.invalid.length) parts.push(`${prepared.invalid.length} not sent (errors)`);
      if (result.errors.length || prepared.invalid.length) toast.warning(parts.join(" · "));
      else toast.success(`Saved ${result.created.length} submission${result.created.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error("Save failed", { description: errorText(e) });
      if (isApiError(e) && e.fieldErrors) toast.message(e.detail);
    } finally {
      setSaving(false);
    }
  };

  const clearUnsaved = () => {
    setRows((prev) => {
      const next: Record<string, FormValues> = {};
      for (const id of Object.keys(prev)) if (saved[id]) next[id] = prev[id]!;
      return next;
    });
    setServerErrors({});
    setTouched(new Set());
    setAttempted(false);
  };

  const savedCount = athletes.filter((a) => saved[a.id]).length;

  return (
    <div className="flex min-h-0 flex-col rounded-lg border bg-card">
      <div
        ref={gridRef}
        role="grid"
        aria-label={`${form.name} team entry for ${date}`}
        aria-rowcount={athletes.length + 1}
        className="relative max-h-[calc(100dvh-16rem)] min-h-40 overflow-auto"
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr role="row">
              <th
                role="columnheader"
                scope="col"
                className="sticky top-0 left-0 z-30 w-56 min-w-56 border-r border-b bg-muted px-3 py-1.5 text-left text-xs font-medium text-muted-foreground"
              >
                Name
              </th>
              {columns.map((c) => (
                <ColumnHeader key={c.field.key} column={c} />
              ))}
              <th
                role="columnheader"
                scope="col"
                className="sticky top-0 z-20 min-w-32 border-b bg-muted px-3 py-1.5 text-left text-xs font-medium text-muted-foreground"
              >
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {athletes.map((a, r) => (
              <GridRow
                key={a.id}
                athlete={a}
                rowIndex={r}
                columns={columns}
                compiled={compiled}
                values={rows[a.id]}
                lockedSubmission={locked.get(a.id) ?? null}
                justSaved={!!saved[a.id]}
                earlier={form.allow_multiple_per_day ? (existing?.get(a.id)?.length ?? 0) : 0}
                serverErrors={serverErrors[a.id]}
                touched={touched}
                attempted={attempted}
                onChange={onChange}
                onBlur={onBlur}
                onOpenSubmission={onOpenSubmission}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-3 py-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-live="polite">
          <span className="tabular">
            <span className="font-medium text-foreground">{pending.length}</span> to save
          </span>
          {invalidCount > 0 && (
            <span className="text-destructive tabular">
              {invalidCount} with errors
            </span>
          )}
          {savedCount > 0 && <span className="tabular text-flag-green">{savedCount} saved</span>}
          <span className="hidden items-center gap-1 lg:inline-flex">
            <Info aria-hidden className="size-3" /> Tab / Enter / arrows to move · paste from a spreadsheet · Ctrl+S saves
          </span>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={clearUnsaved} disabled={pending.length === 0 || saving}>
            <Undo2 /> Clear unsaved
          </Button>
          <Button size="sm" onClick={() => void saveAll()} disabled={pending.length === 0 || saving}>
            {saving ? <Spinner className="text-current" /> : <Save />}
            Save all{pending.length ? ` (${pending.length})` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Bulk errors that are not about a field: `{athlete_id: "not_found" | "forbidden"}` or
 * `{local_date: "duplicate"}` (docs/API.md BulkSubmissionResult).
 */
function rowLevelError(errors: Record<string, string> | undefined, columns: readonly Column[]): string | null {
  if (!errors) return null;
  for (const [key, code] of Object.entries(errors)) {
    if (columns.some((c) => c.field.key === key)) continue;
    if (key === "local_date" && code === "duplicate") return "Already submitted";
    if (key === "athlete_id" && code === "forbidden") return "No write access";
    if (key === "athlete_id" && code === "not_found") return "Not found";
    return `${key}: ${code}`;
  }
  return null;
}

function ColumnHeader({ column }: { column: Column }) {
  const f = column.field;
  const hint =
    f.type === "number" || f.type === "scale"
      ? rangeHint(f.min, f.max, f.unit)
      : f.type === "duration"
        ? rangeHint(f.min, f.max, "min") ?? "min"
        : f.type === "calculated"
          ? (f.unit ?? "calculated")
          : (f.unit ?? null);
  const width =
    f.type === "text" || f.type === "textarea" || f.type === "multiselect" ? "min-w-44" : f.type === "select" ? "min-w-36" : f.type === "datetime" ? "min-w-48" : f.type === "date" ? "min-w-36" : "min-w-24";
  const header = (
    <th
      role="columnheader"
      scope="col"
      className={cn(
        "sticky top-0 z-20 max-w-48 border-b border-l bg-muted px-2 py-1.5 text-left align-bottom text-xs font-medium",
        width,
        column.kind === "calc" ? "text-muted-foreground" : "text-foreground",
      )}
    >
      <div className="truncate">
        {f.label}
        {f.required && column.kind === "input" && (
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </div>
      {hint && <div className="truncate text-[11px] font-normal text-muted-foreground">{hint}</div>}
    </th>
  );
  if (!f.help) return header;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{header}</TooltipTrigger>
      <TooltipContent>{f.help}</TooltipContent>
    </Tooltip>
  );
}

const GridRow = memo(function GridRow({
  athlete,
  rowIndex,
  columns,
  compiled,
  values,
  lockedSubmission,
  justSaved,
  earlier,
  serverErrors,
  touched,
  attempted,
  onChange,
  onBlur,
  onOpenSubmission,
}: {
  athlete: GridAthlete;
  rowIndex: number;
  columns: Column[];
  compiled: ReturnType<typeof compileForm>;
  values: FormValues | undefined;
  lockedSubmission: Submission | null;
  justSaved: boolean;
  earlier: number;
  serverErrors: Record<string, string> | undefined;
  touched: ReadonlySet<string>;
  attempted: boolean;
  onChange(athleteId: string, key: string, value: unknown): void;
  onBlur(athleteId: string, key: string): void;
  onOpenSubmission?: ((s: Submission) => void) | undefined;
}) {
  const shownValues = lockedSubmission && !justSaved ? lockedSubmission.values : (values ?? EMPTY_VALUES);
  const result = useMemo(() => compiled.validate(shownValues), [compiled, shownValues]);
  const computed = lockedSubmission && !justSaved ? { ...result.computed, ...lockedSubmission.computed } : result.computed;
  const empty = isRowEmpty(values);
  const readOnly = !!lockedSubmission || justSaved;
  const errorCount = readOnly || empty ? 0 : Object.keys(result.errors).length + Object.keys(serverErrors ?? {}).length;

  const rowLevel = rowLevelError(serverErrors, columns);
  let status: ReactNode = <span className="text-muted-foreground/50">–</span>;
  if (justSaved) status = <Badge variant="success"><CircleCheck aria-hidden /> Saved</Badge>;
  else if (lockedSubmission)
    status = (
      <button type="button" onClick={() => onOpenSubmission?.(lockedSubmission)} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <Badge variant="secondary">Submitted</Badge>
      </button>
    );
  else if (rowLevel) status = <Badge variant="destructive" title={rowLevel}><CircleAlert aria-hidden /> {rowLevel}</Badge>;
  else if (serverErrors && Object.keys(serverErrors).length > 0) status = <Badge variant="destructive"><CircleAlert aria-hidden /> Rejected</Badge>;
  else if (!empty && errorCount > 0 && attempted) status = <Badge variant="destructive">{errorCount} error{errorCount === 1 ? "" : "s"}</Badge>;
  else if (!empty) status = <Badge variant={errorCount ? "warning" : "brand"}>{errorCount ? "Incomplete" : "Ready"}</Badge>;
  else if (earlier > 0) status = <span className="text-xs text-muted-foreground">{earlier} earlier</span>;

  return (
    <tr role="row" className={cn("group", readOnly && "bg-muted/30")} data-athlete={athlete.id}>
      <th
        role="rowheader"
        scope="row"
        className="sticky left-0 z-10 border-r border-b bg-card px-3 py-0 text-left font-normal group-focus-within:bg-accent"
      >
        <div className="flex h-8 items-center gap-2">
          <span className="truncate font-medium">{athlete.label}</span>
          {athlete.sublabel && <span className="truncate text-xs text-muted-foreground">{athlete.sublabel}</span>}
        </div>
      </th>
      {columns.map((c) => {
        const key = c.field.key;
        const visible = result.visible[key] !== false;
        if (c.kind === "calc") {
          return (
            <td key={key} className="border-b border-l bg-muted/40 px-2 text-right text-sm text-muted-foreground tabular" aria-readonly>
              {visible && !(empty && !readOnly) ? formatFieldValue(c.field, computed[key]) : ""}
            </td>
          );
        }
        if (readOnly) {
          return (
            <td key={key} className="border-b border-l px-2 text-sm text-muted-foreground" aria-readonly>
              {visible ? formatFieldValue(c.field, shownValues[key]).replace(/^–$/, "") : ""}
            </td>
          );
        }
        const code = serverErrors?.[key] ?? (visible && !empty ? result.errors[key] : undefined);
        const show = !!serverErrors?.[key] || (code !== undefined && (attempted || touched.has(`${athlete.id}:${key}`)));
        const error = show && code ? errorMessage(code, c.field) : null;
        const cell = (
          <td
            key={key}
            className={cn(
              "border-b border-l p-0",
              !visible && "bg-muted/50",
              error && "bg-destructive/10 shadow-[inset_0_0_0_1px_var(--destructive)]",
            )}
            title={error ?? undefined}
          >
            <GridCell
              field={c.field}
              value={shownValues[key]}
              row={rowIndex}
              col={c.index}
              athleteId={athlete.id}
              disabled={!visible}
              error={error}
              onChange={onChange}
              onBlur={onBlur}
              label={`${c.field.label}, ${athlete.label}`}
            />
          </td>
        );
        return cell;
      })}
      <td className="border-b border-l px-2 pr-3 whitespace-nowrap">{status}</td>
    </tr>
  );
});
