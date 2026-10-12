import { valuesEqual, type InputField, type MultiselectField } from "@ams/shared";
import { ChevronDown } from "lucide-react";
import { memo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseCellText } from "@/components/entry/grid-logic";
import { formatNumber, isoToLocalDateTime, localDateTimeToISO, optionLabel } from "@/lib/field-format";
import { cn } from "@/lib/utils";

export interface GridCellProps {
  field: InputField;
  value: unknown;
  row: number;
  col: number;
  athleteId: string;
  disabled: boolean;
  error: string | null;
  onChange(athleteId: string, key: string, value: unknown): void;
  onBlur(athleteId: string, key: string): void;
  label: string;
}

export const cellInputClass =
  "h-8 w-full min-w-0 rounded-none border-0 bg-transparent px-2 text-sm outline-none focus:bg-background focus:ring-2 focus:ring-brand/60 focus:ring-inset disabled:cursor-not-allowed";

function textFor(field: InputField, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string") return value;
  void field;
  return String(value);
}

/** Free-typed cell for numbers, scales, durations and text, keeping the user's draft while it parses to the value. */
function TypedCell({ field, value, row, col, athleteId, disabled, error, onChange, onBlur, label }: GridCellProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const derived = textFor(field, value);
  const parsedDraft = draft === null ? undefined : parseCellText(field, draft);
  const inSync = draft !== null && (valuesEqual(parsedDraft, value) || (parsedDraft === undefined && (value === undefined || value === null)));
  const shown = inSync ? draft! : derived;
  const numeric = field.type === "number" || field.type === "scale" || field.type === "duration";
  return (
    <input
      data-cell={`${row}:${col}`}
      aria-label={label}
      aria-invalid={error ? true : undefined}
      inputMode={numeric ? (field.type === "duration" ? "text" : "decimal") : undefined}
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      value={disabled ? "" : shown}
      placeholder={disabled ? "–" : field.type === "duration" ? "min or h:mm" : undefined}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(athleteId, field.key, parseCellText(field, e.target.value));
      }}
      onBlur={() => {
        setDraft(null);
        onBlur(athleteId, field.key);
      }}
      className={cn(
        cellInputClass,
        numeric && "text-right tabular",
        disabled ? "placeholder:text-muted-foreground/40" : "placeholder:text-transparent focus:placeholder:text-muted-foreground/60",
      )}
    />
  );
}

function ChoiceCell({ field, value, row, col, athleteId, disabled, error, onChange, onBlur, label }: GridCellProps) {
  const options =
    field.type === "boolean"
      ? [
          { value: true as unknown, label: "Yes" },
          { value: false as unknown, label: "No" },
        ]
      : field.type === "select"
        ? field.options.map((o) => ({
            value: o.value as unknown,
            // Numeric scales (e.g. CR-10) type-ahead by number.
            label: typeof o.value === "number" && !o.label.startsWith(String(o.value)) ? `${o.value} · ${o.label}` : o.label,
          }))
        : [];
  const index = options.findIndex((o) => valuesEqual(o.value, value));
  const invalidRaw = value !== undefined && value !== null && index < 0;
  return (
    <select
      data-cell={`${row}:${col}`}
      aria-label={label}
      aria-invalid={error ? true : undefined}
      disabled={disabled}
      value={disabled ? "" : invalidRaw ? "__raw" : index >= 0 ? String(index) : ""}
      onChange={(e) => onChange(athleteId, field.key, e.target.value === "" ? undefined : options[Number(e.target.value)]?.value)}
      onBlur={() => onBlur(athleteId, field.key)}
      className={cn(cellInputClass, "appearance-none pr-1", index < 0 && !invalidRaw && "text-muted-foreground")}
    >
      <option value="">{disabled ? "–" : ""}</option>
      {invalidRaw && <option value="__raw">{String(value)}</option>}
      {options.map((o, i) => (
        <option key={i} value={String(i)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function MultiCell({ field, value, row, col, athleteId, disabled, error, onChange, onBlur, label }: GridCellProps) {
  const f = field as MultiselectField;
  const selected = Array.isArray(value) ? (value as unknown[]) : [];
  const [open, setOpen] = useState(false);
  const toggle = (v: unknown) => {
    const has = selected.some((s) => valuesEqual(s, v));
    const next = has
      ? selected.filter((s) => !valuesEqual(s, v))
      : f.options.map((o) => o.value).filter((ov) => valuesEqual(ov, v) || selected.some((s) => valuesEqual(s, ov)));
    onChange(athleteId, field.key, next.length ? next : undefined);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) onBlur(athleteId, field.key);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-cell={`${row}:${col}`}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          disabled={disabled}
          className={cn(cellInputClass, "flex items-center gap-1 text-left")}
        >
          <span className={cn("flex-1 truncate", selected.length === 0 && "text-muted-foreground")}>
            {disabled ? "–" : selected.map((s) => optionLabel(f.options, s)).join(", ")}
          </span>
          {!disabled && <ChevronDown aria-hidden className="size-3 shrink-0 opacity-50" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {f.options.map((o, i) => {
          const checked = selected.some((s) => valuesEqual(s, o.value));
          return (
            <label key={i} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
              <Checkbox checked={checked} onCheckedChange={() => toggle(o.value)} />
              {o.label}
            </label>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function NativeCell({ field, value, row, col, athleteId, disabled, error, onChange, onBlur, label }: GridCellProps) {
  const type = field.type === "datetime" ? "datetime-local" : field.type;
  const shown = field.type === "datetime" ? isoToLocalDateTime(value) : typeof value === "string" ? value : "";
  return (
    <input
      type={type}
      data-cell={`${row}:${col}`}
      aria-label={label}
      aria-invalid={error ? true : undefined}
      disabled={disabled}
      value={disabled ? "" : shown}
      onChange={(e) => {
        const v = e.target.value;
        onChange(athleteId, field.key, v === "" ? undefined : field.type === "datetime" ? (localDateTimeToISO(v) ?? v) : v);
      }}
      onBlur={() => onBlur(athleteId, field.key)}
      className={cn(cellInputClass, "text-xs")}
    />
  );
}

export const GridCell = memo(function GridCell(props: GridCellProps) {
  switch (props.field.type) {
    case "select":
    case "boolean":
      return <ChoiceCell {...props} />;
    case "multiselect":
      return <MultiCell {...props} />;
    case "date":
    case "time":
    case "datetime":
      return <NativeCell {...props} />;
    default:
      return <TypedCell {...props} />;
  }
});
