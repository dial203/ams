/**
 * Input controls for each field type of the form schema (docs/FORMS.md). Each control
 * reports `undefined` for "no value". Used by FormRenderer.
 */
import {
  scaleDisplay,
  scaleValues,
  valuesEqual,
  maxLengthOf,
  type BooleanField,
  type DurationField,
  type FieldOption,
  type InputField,
  type MultiselectField,
  type NumberField,
  type ScaleField,
  type SelectField,
} from "@ams/shared";
import { Check } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  formatNumber,
  isoToLocalDateTime,
  localDateTimeToISO,
  parseNumberInput,
} from "@/lib/field-format";
import { useNumericDraft } from "@/hooks/use-numeric-draft";
import { codePointCount } from "@/lib/text";
import { cn } from "@/lib/utils";

export interface ControlProps<F extends InputField = InputField> {
  field: F;
  value: unknown;
  onChange(value: unknown): void;
  onBlur?(): void;
  id: string;
  labelId: string;
  describedBy?: string | undefined;
  invalid?: boolean;
  required?: boolean;
  disabled?: boolean;
}

export function FieldControl(props: ControlProps) {
  const { field } = props;
  switch (field.type) {
    case "scale":
      return <ScaleControl {...(props as ControlProps<ScaleField>)} />;
    case "select":
      return <SelectControl {...(props as ControlProps<SelectField>)} />;
    case "multiselect":
      return <MultiselectControl {...(props as ControlProps<MultiselectField>)} />;
    case "boolean":
      return <BooleanControl {...(props as ControlProps<BooleanField>)} />;
    case "number":
      return <NumberControl {...(props as ControlProps<NumberField>)} />;
    case "duration":
      return <DurationControl {...(props as ControlProps<DurationField>)} />;
    case "text":
    case "textarea":
      return <TextControl {...props} />;
    case "date":
    case "time":
      return (
        <Input
          id={props.id}
          type={field.type}
          className="w-44"
          value={typeof props.value === "string" ? props.value : ""}
          min={field.type === "date" && typeof field.min === "string" ? field.min : undefined}
          max={field.type === "date" && typeof field.max === "string" ? field.max : undefined}
          onChange={(e) => props.onChange(e.target.value === "" ? undefined : e.target.value)}
          onBlur={props.onBlur}
          aria-invalid={props.invalid || undefined}
          aria-required={props.required || undefined}
          aria-describedby={props.describedBy}
          disabled={props.disabled}
        />
      );
    case "datetime":
      return (
        <Input
          id={props.id}
          type="datetime-local"
          className="w-56"
          value={isoToLocalDateTime(props.value)}
          onChange={(e) => props.onChange(e.target.value === "" ? undefined : (localDateTimeToISO(e.target.value) ?? e.target.value))}
          onBlur={props.onBlur}
          aria-invalid={props.invalid || undefined}
          aria-required={props.required || undefined}
          aria-describedby={props.describedBy}
          disabled={props.disabled}
        />
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Choice groups (radio semantics with roving focus)

interface ChoiceOption {
  key: string;
  value: unknown;
  label: string;
}

/** Segmented control with radio semantics: arrow keys move and select, Tab leaves the group. */
export function ChoiceGroup({
  options,
  value,
  onChange,
  labelId,
  describedBy,
  invalid,
  disabled,
  id,
  onBlur,
  className,
  buttonClassName,
  wrap = true,
  required,
}: {
  options: ChoiceOption[];
  value: unknown;
  onChange(value: unknown): void;
  labelId: string;
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
  id: string;
  onBlur?: (() => void) | undefined;
  className?: string;
  buttonClassName?: string;
  wrap?: boolean;
  required?: boolean | undefined;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((o) => valuesEqual(o.value, value));
  const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next >= 0) {
      e.preventDefault();
      refs.current[next]?.focus();
      onChange(options[next]!.value);
    }
  };

  return (
    <div
      role="radiogroup"
      id={id}
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={required || undefined}
      className={cn(
        "inline-flex max-w-full gap-1 rounded-md",
        wrap ? "flex-wrap" : "flex-nowrap",
        invalid && "rounded-md ring-1 ring-destructive/60 ring-offset-2 ring-offset-background",
        className,
      )}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur?.();
      }}
    >
      {options.map((o, i) => {
        const checked = i === selectedIndex;
        return (
          <button
            key={o.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === focusIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex h-8 min-w-9 items-center justify-center rounded-md border px-2.5 text-sm font-medium transition-colors outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60",
              checked
                ? "border-primary bg-primary text-primary-foreground shadow-xs"
                : "border-input bg-background text-foreground hover:bg-accent dark:bg-input/20",
              buttonClassName,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ScaleControl({ required, field, value, onChange, onBlur, id, labelId, describedBy, invalid, disabled }: ControlProps<ScaleField>) {
  const points = scaleValues(field);
  const display = scaleDisplay(field);
  const anchors = field.anchors ?? {};

  if (display === "slider" || points.length === 0) {
    const has = typeof value === "number";
    return (
      <div className="grid max-w-md gap-1.5">
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="range"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={has ? (value as number) : field.min}
            onChange={(e) => onChange(Number(e.target.value))}
            onBlur={onBlur}
            aria-labelledby={labelId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            aria-required={required || undefined}
            aria-valuetext={has ? String(value) : "Not set"}
            disabled={disabled}
            className={cn("h-2 flex-1 cursor-pointer accent-[var(--primary)]", !has && "opacity-40")}
          />
          <output
            htmlFor={id}
            className={cn(
              "w-12 rounded-md border px-1.5 py-0.5 text-center text-sm tabular",
              has ? "font-medium" : "text-muted-foreground",
            )}
          >
            {has ? formatNumber(value as number) : "–"}
          </output>
        </div>
        <Anchors min={anchors.min} mid={anchors.mid} max={anchors.max} />
      </div>
    );
  }

  const options = points.map((p) => ({ key: String(p), value: p, label: formatNumber(p) }));
  return (
    <div className="grid w-fit max-w-full gap-1.5">
      <ChoiceGroup
        id={id}
        options={options}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        labelId={labelId}
        describedBy={describedBy}
        invalid={invalid}
        required={required}
        disabled={disabled}
        buttonClassName="tabular min-w-9 px-0 sm:min-w-10"
      />
      <Anchors min={anchors.min} mid={anchors.mid} max={anchors.max} />
    </div>
  );
}

function Anchors({ min, mid, max }: { min?: string | undefined; mid?: string | undefined; max?: string | undefined }) {
  if (!min && !mid && !max) return null;
  return (
    <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
      <span className="text-left">{min}</span>
      <span className="text-center">{mid}</span>
      <span className="text-right">{max}</span>
    </div>
  );
}

function toChoices(options: readonly FieldOption[]): ChoiceOption[] {
  return options.map((o, i) => ({ key: `${i}:${String(o.value)}`, value: o.value, label: o.label }));
}

function SelectControl({ required, field, value, onChange, onBlur, id, labelId, describedBy, invalid, disabled }: ControlProps<SelectField>) {
  const options = field.options ?? [];
  if (options.length <= 5) {
    return (
      <ChoiceGroup
        id={id}
        options={toChoices(options)}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        labelId={labelId}
        describedBy={describedBy}
        invalid={invalid}
        required={required}
        disabled={disabled}
      />
    );
  }
  const index = options.findIndex((o) => valuesEqual(o.value, value));
  return (
    <NativeSelect
      id={id}
      wrapperClassName="max-w-sm"
      value={index >= 0 ? String(index) : ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : options[Number(e.target.value)]?.value)}
      onBlur={onBlur}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={required || undefined}
      disabled={disabled}
    >
      <option value="">Select…</option>
      {options.map((o, i) => (
        <option key={i} value={String(i)}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

function MultiselectControl({ required, field, value, onChange, onBlur, id, labelId, describedBy, invalid, disabled }: ControlProps<MultiselectField>) {
  const options = field.options ?? [];
  const selected = Array.isArray(value) ? (value as unknown[]) : [];
  const max = typeof field.max_selected === "number" ? field.max_selected : null;
  const atMax = max !== null && selected.length >= max;
  const toggle = (v: unknown) => {
    const has = selected.some((s) => valuesEqual(s, v));
    if (has) {
      const next = selected.filter((s) => !valuesEqual(s, v));
      onChange(next.length === 0 ? undefined : next);
    } else {
      // Keep option order regardless of click order.
      const next = options.map((o) => o.value).filter((ov) => valuesEqual(ov, v) || selected.some((s) => valuesEqual(s, ov)));
      onChange(next);
    }
  };
  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-required={required || undefined}
      className={cn("flex flex-wrap gap-1.5", invalid && "rounded-md ring-1 ring-destructive/60 ring-offset-2 ring-offset-background")}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur?.();
      }}
    >
      {options.map((o, i) => {
        const checked = selected.some((s) => valuesEqual(s, o.value));
        const blocked = !checked && atMax;
        return (
          <button
            key={`${i}:${String(o.value)}`}
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-disabled={blocked || undefined}
            disabled={disabled}
            onClick={() => !blocked && toggle(o.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60",
              checked
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-accent dark:bg-input/20",
              blocked && "cursor-not-allowed opacity-50 hover:bg-background",
            )}
          >
            {checked && <Check aria-hidden className="size-3.5" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function BooleanControl({ required, value, onChange, onBlur, id, labelId, describedBy, invalid, disabled }: ControlProps<BooleanField>) {
  return (
    <ChoiceGroup
      id={id}
      options={[
        { key: "yes", value: true, label: "Yes" },
        { key: "no", value: false, label: "No" },
      ]}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      labelId={labelId}
      describedBy={describedBy}
      invalid={invalid}
      required={required}
      disabled={disabled}
      buttonClassName="min-w-14"
    />
  );
}

function NumberControl({ required, field, value, onChange, onBlur, id, describedBy, invalid, disabled }: ControlProps<NumberField>) {
  const [text, setText] = useNumericDraft(value);
  const step = typeof field.step === "number" ? field.step : typeof field.decimals === "number" ? 10 ** -field.decimals : undefined;
  return (
    <div className="relative w-40">
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        data-step={step}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseNumberInput(e.target.value));
        }}
        onBlur={onBlur}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        className={cn("tabular", field.unit && "pr-10")}
      />
      {field.unit && (
        <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
          {field.unit}
        </span>
      )}
    </div>
  );
}

function DurationControl({ required, value, onChange, onBlur, id, labelId, describedBy, invalid, disabled }: ControlProps<DurationField>) {
  const minutes = typeof value === "number" && isFinite(value) ? value : null;
  const [hDraft, setHDraft] = useState<string | null>(null);
  const [mDraft, setMDraft] = useState<string | null>(null);
  const hours = minutes === null ? "" : String(Math.trunc(minutes / 60));
  const mins = minutes === null ? "" : formatNumber(minutes - Math.trunc(minutes / 60) * 60);

  const commit = (hText: string, mText: string) => {
    const h = hText.trim() === "" ? null : Number(hText);
    const m = mText.trim() === "" ? null : Number(mText.replace(",", "."));
    if (h === null && m === null) return onChange(undefined);
    if ((h !== null && !isFinite(h)) || (m !== null && !isFinite(m))) return onChange(`${hText}:${mText}`);
    onChange((h ?? 0) * 60 + (m ?? 0));
  };
  const hShown = hDraft ?? hours;
  const mShown = mDraft ?? mins;

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-required={required || undefined}
      className="flex items-center gap-1.5"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setHDraft(null);
          setMDraft(null);
          onBlur?.();
        }
      }}
    >
      <div className="relative w-20">
        <Input
          id={id}
          inputMode="numeric"
          aria-label="Hours"
          value={hShown}
          onChange={(e) => {
            setHDraft(e.target.value);
            commit(e.target.value, mShown);
          }}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className="pr-6 tabular"
        />
        <span aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">
          h
        </span>
      </div>
      <div className="relative w-20">
        <Input
          inputMode="decimal"
          aria-label="Minutes"
          value={mShown}
          onChange={(e) => {
            setMDraft(e.target.value);
            commit(hShown, e.target.value);
          }}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className="pr-9 tabular"
        />
        <span aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">
          min
        </span>
      </div>
      {minutes !== null && minutes >= 60 && (
        <span className="text-xs text-muted-foreground tabular">= {formatNumber(minutes)} min</span>
      )}
    </div>
  );
}

function TextControl({ field, value, onChange, onBlur, id, describedBy, invalid, required, disabled }: ControlProps) {
  const text = typeof value === "string" ? value : "";
  const max = maxLengthOf(field as { type: string; max_length?: number });
  const count = codePointCount(text);
  const over = count > max;
  const common = {
    id,
    value: text,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value === "" ? undefined : e.target.value),
    onBlur,
    "aria-invalid": invalid || undefined,
    "aria-required": required || undefined,
    "aria-describedby": describedBy,
    disabled,
  };
  return (
    <div className="grid max-w-xl gap-1">
      {field.type === "textarea" ? <Textarea rows={3} {...common} /> : <Input {...common} />}
      {(count > 0 || field.type === "textarea") && (count > max * 0.8 || field.type === "textarea") && (
        <span className={cn("justify-self-end text-xs tabular", over ? "text-destructive" : "text-muted-foreground")}>
          {count}/{max}
        </span>
      )}
    </div>
  );
}
