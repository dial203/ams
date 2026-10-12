/**
 * Renders any form schema (docs/FORMS.md) with the shared engine: `compileForm` runs on
 * every change for visibility, calculated values and validation. Errors appear after the
 * first submit attempt or when a field loses focus. Supports read-only display and
 * server-side (422) field errors.
 */
import {
  compileForm,
  errorMessage,
  isEmptyValue,
  type Field,
  type FormSchema,
  type FormValues,
  type InputField,
  type Section,
  type SubmissionValidation,
} from "@ams/shared";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { FieldControl } from "@/components/forms/FieldControls";
import { Markdown } from "@/components/forms/Markdown";
import { Spinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { EMPTY_TEXT, formatFieldValue, rangeHint } from "@/lib/field-format";
import { cn } from "@/lib/utils";

export interface FormRendererProps {
  schema: FormSchema;
  /** Controlled values (field key -> raw value). */
  values?: FormValues;
  /** Starting values when uncontrolled (e.g. an existing submission). */
  initialValues?: FormValues;
  onChange?(values: FormValues, result: SubmissionValidation): void;
  /** Called on submit when the values pass validation, with the engine result (`result.values` is the payload). */
  onSubmit?(result: SubmissionValidation): void | Promise<void>;
  /** Display values only. */
  readOnly?: boolean;
  /** Field error codes from the server (422 `field_errors`); each clears once its field changes. */
  serverErrors?: Record<string, string> | null;
  /** Show every validation error immediately (builder test panel). */
  showAllErrors?: boolean;
  submitLabel?: string;
  hideSubmit?: boolean;
  /** Extra buttons rendered next to submit. */
  actions?: ReactNode;
  /** Disables inputs (e.g. while saving). */
  disabled?: boolean;
  busy?: boolean;
  id?: string;
  className?: string;
  /** Tighter spacing (side panels). */
  compact?: boolean;
}

function withoutKey(values: FormValues, key: string): FormValues {
  const next: FormValues = {};
  for (const k of Object.keys(values)) if (k !== key) next[k] = values[k];
  return next;
}

export function FormRenderer({
  schema,
  values: controlled,
  initialValues,
  onChange,
  onSubmit,
  readOnly = false,
  serverErrors,
  showAllErrors = false,
  submitLabel = "Submit",
  hideSubmit = false,
  actions,
  disabled = false,
  busy = false,
  id,
  className,
  compact = false,
}: FormRendererProps) {
  const autoId = useId();
  const prefix = id ?? `form${autoId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const compiled = useMemo(() => compileForm(schema), [schema]);
  const [internal, setInternal] = useState<FormValues>(() => ({ ...(initialValues ?? {}) }));
  const values = controlled ?? internal;
  const result = useMemo(() => compiled.validate(values), [compiled, values]);

  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  // Server errors stay until their field is edited; reset when a new error object arrives.
  const [serverState, setServerState] = useState<{ source: typeof serverErrors; cleared: ReadonlySet<string> }>({
    source: serverErrors,
    cleared: new Set(),
  });
  let cleared = serverState.cleared;
  if (serverState.source !== serverErrors) {
    cleared = new Set();
    setServerState({ source: serverErrors, cleared });
  }

  const setValue = (key: string, value: unknown) => {
    const next = value === undefined ? withoutKey(values, key) : { ...values, [key]: value };
    if (controlled === undefined) setInternal(next);
    if (serverErrors && serverErrors[key] !== undefined && !cleared.has(key)) {
      setServerState({ source: serverErrors, cleared: new Set([...cleared, key]) });
    }
    onChange?.(next, compiled.validate(next));
  };

  const markTouched = (key: string) => {
    if (!touched.has(key)) setTouched(new Set([...touched, key]));
  };

  const errorFor = (field: Field): string | null => {
    const server = serverErrors?.[field.key];
    if (server !== undefined && !cleared.has(field.key)) return errorMessage(server, field);
    const code = result.errors[field.key];
    if (code && (submitted || showAllErrors || touched.has(field.key))) return errorMessage(code, field);
    return null;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (readOnly || !onSubmit) return;
    setSubmitted(true);
    const r = compiled.validate(values);
    if (!r.ok) {
      const first = compiled.fields.find((l) => r.errors[l.field.key] !== undefined);
      if (first) document.getElementById(`${prefix}-${first.field.key}`)?.focus();
      return;
    }
    await onSubmit(r);
  };

  const sections: Section[] = Array.isArray(schema.sections) ? schema.sections : [];
  const unknownErrors = Object.keys(result.errors).filter(
    (k) => result.errors[k] === "unknown_field" && (submitted || showAllErrors),
  );

  return (
    <form
      id={prefix}
      noValidate
      onSubmit={handleSubmit}
      className={cn("grid", compact ? "gap-5" : "gap-7", className)}
      aria-busy={busy || undefined}
    >
      {sections.map((section, si) => {
        const fields = (Array.isArray(section.fields) ? section.fields : []).filter((f) => result.visible[f.key] !== false);
        if (fields.length === 0) return null;
        return (
          <section key={`${section.key}-${si}`} aria-labelledby={`${prefix}-s${si}`} className="grid gap-4">
            {(section.title || section.description) && (
              <header className="grid gap-1 border-b pb-2">
                <h3 id={`${prefix}-s${si}`} className="text-sm font-semibold">
                  {section.title}
                </h3>
                <Markdown source={section.description} className="text-muted-foreground" />
              </header>
            )}
            <div className={cn("grid", compact ? "gap-4" : "gap-5")}>
              {fields.map((field) => (
                <FieldBlock
                  key={field.key}
                  prefix={prefix}
                  field={field}
                  value={field.type === "calculated" ? result.computed[field.key] : values[field.key]}
                  error={readOnly ? null : errorFor(field)}
                  readOnly={readOnly}
                  disabled={disabled || busy}
                  onChange={(v) => setValue(field.key, v)}
                  onBlur={() => markTouched(field.key)}
                />
              ))}
            </div>
          </section>
        );
      })}
      {unknownErrors.length > 0 && !readOnly && (
        <p role="alert" className="text-xs text-destructive">
          Values for fields that are not in this form: {unknownErrors.join(", ")}.
        </p>
      )}
      {!readOnly && onSubmit && !hideSubmit && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button type="submit" disabled={disabled || busy}>
            {busy && <Spinner className="text-current" />}
            {submitLabel}
          </Button>
          {actions}
          {submitted && !result.ok && (
            <span className="text-xs text-destructive" role="status">
              {Object.keys(result.errors).length === 1
                ? "1 field needs attention."
                : `${Object.keys(result.errors).length} fields need attention.`}
            </span>
          )}
        </div>
      )}
      {(readOnly || !onSubmit || hideSubmit) && actions && <div className="flex gap-2">{actions}</div>}
    </form>
  );
}

function FieldBlock({
  prefix,
  field,
  value,
  error,
  readOnly,
  disabled,
  onChange,
  onBlur,
}: {
  prefix: string;
  field: Field;
  value: unknown;
  error: string | null;
  readOnly: boolean;
  disabled: boolean;
  onChange(value: unknown): void;
  onBlur(): void;
}) {
  const inputId = `${prefix}-${field.key}`;
  const labelId = `${inputId}-label`;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;

  if (field.type === "info") {
    return (
      <div className="rounded-md border bg-muted/40 px-3.5 py-3" data-field={field.key}>
        <div className="text-sm font-medium">{field.label}</div>
        <Markdown source={field.help} className="mt-1 text-muted-foreground" />
      </div>
    );
  }

  if (field.type === "calculated") {
    return (
      <div className="grid gap-1" data-field={field.key}>
        <div id={labelId} className="text-[13px] font-medium text-muted-foreground">
          {field.label}
        </div>
        <output
          id={inputId}
          aria-labelledby={labelId}
          aria-live="polite"
          className={cn(
            "w-fit min-w-16 rounded-md border border-dashed bg-muted/40 px-2.5 py-1 text-sm font-medium tabular",
            isEmptyValue(value) && "text-muted-foreground",
          )}
        >
          {formatFieldValue(field, value)}
        </output>
        {field.help && <Markdown source={field.help} className="text-xs text-muted-foreground" />}
      </div>
    );
  }

  const input = field as InputField;
  if (readOnly) {
    return (
      <div className="grid gap-1 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4" data-field={field.key}>
        <div id={labelId} className="text-[13px] text-muted-foreground">
          {field.label}
        </div>
        <ReadOnlyValue field={input} value={value} labelId={labelId} />
      </div>
    );
  }

  const groupLike = ["scale", "select", "multiselect", "boolean", "duration"].includes(field.type);
  const hint = numericHint(input);
  const describedBy = [field.help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid gap-1.5" data-field={field.key}>
      <div className="flex items-baseline gap-2">
        {groupLike && field.type !== "select" ? (
          <div id={labelId} className="text-[13px] font-medium">
            {field.label}
            {field.required && <RequiredMark />}
          </div>
        ) : (
          <label id={labelId} htmlFor={inputId} className="text-[13px] font-medium">
            {field.label}
            {field.required && <RequiredMark />}
          </label>
        )}
        {hint && <span className="text-xs text-muted-foreground tabular">{hint}</span>}
        {!field.required && !isEmptyValue(value) && ["scale", "select", "boolean"].includes(field.type) && !disabled && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
      {field.help && (
        <div id={helpId}>
          <Markdown source={field.help} className="text-xs text-muted-foreground" />
        </div>
      )}
      <FieldControl
        field={input}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        id={inputId}
        labelId={labelId}
        describedBy={describedBy}
        invalid={!!error}
        required={!!field.required}
        disabled={disabled}
      />
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Visual marker only; controls carry `aria-required`. */
function RequiredMark() {
  return (
    <span aria-hidden className="ml-0.5 text-destructive">
      *
    </span>
  );
}

function numericHint(field: InputField): string | null {
  if (field.type === "number") return rangeHint(field.min, field.max, field.unit);
  if (field.type === "duration") return rangeHint(field.min, field.max, "min");
  if (field.type === "multiselect") {
    const lo = field.min_selected;
    const hi = field.max_selected;
    if (typeof lo === "number" && typeof hi === "number") return `Choose ${lo}–${hi}`;
    if (typeof hi === "number") return `Up to ${hi}`;
    if (typeof lo === "number") return `At least ${lo}`;
  }
  return null;
}

function ReadOnlyValue({ field, value, labelId }: { field: InputField; value: unknown; labelId: string }) {
  const text = formatFieldValue(field, value);
  const empty = text === EMPTY_TEXT;
  if (!empty && field.type === "multiselect" && Array.isArray(value)) {
    return (
      <div aria-labelledby={labelId} className="flex flex-wrap gap-1">
        {text.split(", ").map((t, i) => (
          <span key={i} className="rounded-full border px-2 py-0.5 text-xs">
            {t}
          </span>
        ))}
      </div>
    );
  }
  let anchor: string | undefined;
  if (field.type === "scale" && typeof value === "number") {
    if (value === field.min) anchor = field.anchors?.min;
    else if (value === field.max) anchor = field.anchors?.max;
  }
  return (
    <div
      aria-labelledby={labelId}
      className={cn(
        "text-sm",
        empty ? "text-muted-foreground" : "font-medium",
        field.type === "textarea" && "font-normal whitespace-pre-wrap",
      )}
    >
      {empty ? "Not answered" : text}
      {anchor && <span className="ml-1.5 font-normal text-muted-foreground">· {anchor}</span>}
    </div>
  );
}

