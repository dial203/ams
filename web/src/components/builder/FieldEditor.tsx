import {
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  allFields,
  findReferences,
  isValidFieldKey,
  isReservedWord,
  usedKeys,
  type Field,
  type FieldOption,
  type FieldType,
  type FormSchema,
  type Section,
} from "@ams/shared";
import { Copy, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { changeFieldType, setFieldProp } from "@/components/builder/builder-logic";
import { ExpressionInput } from "@/components/builder/ExpressionInput";
import { FieldTypeIcon } from "@/components/builder/FieldTypeIcon";
import { OptionsEditor } from "@/components/builder/OptionsEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { parseNumberInput } from "@/lib/field-format";
import { cn } from "@/lib/utils";

export type PropErrors = Record<string, string>;

function Row({ label, htmlFor, error, hint, children, className }: { label: ReactNode; htmlFor?: string; error?: string | undefined; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Numeric property input: empty removes the property. */
function NumberProp({ id, value, onChange, placeholder, error }: { id: string; value: unknown; onChange(v: number | undefined): void; placeholder?: string; error?: string | undefined }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (typeof value === "number" ? String(value) : "");
  return (
    <Input
      id={id}
      inputMode="decimal"
      value={shown}
      placeholder={placeholder}
      aria-invalid={error ? true : undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        const p = parseNumberInput(e.target.value);
        if (p === undefined) onChange(undefined);
        else if (typeof p === "number") onChange(p);
      }}
      onBlur={() => setDraft(null)}
      className="h-7 tabular"
    />
  );
}

function KeyInput({
  schema,
  field,
  onRename,
  error,
}: {
  schema: FormSchema;
  field: Field;
  onRename(oldKey: string, newKey: string): void;
  error?: string | undefined;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? field.key;
  const others = usedKeys(schema).fields.filter((k) => k !== field.key);
  const refs = findReferences(schema, field.key).filter((r) => r.owner !== field.key || r.section);
  let problem: string | null = null;
  if (draft !== null && draft !== field.key) {
    if (isReservedWord(draft)) problem = `"${draft}" is a reserved word`;
    else if (!isValidFieldKey(draft)) problem = "Start with a lowercase letter; use a–z, 0–9 and _ (max 63)";
    else if (others.includes(draft)) problem = "Another field already uses this key";
  }
  const commit = () => {
    if (draft !== null && draft !== field.key && !problem) onRename(field.key, draft);
    setDraft(null);
  };
  return (
    <Row
      label="Key"
      htmlFor="fe-key"
      error={problem ?? error}
      hint={refs.length > 0 ? `Used in ${refs.length} expression${refs.length === 1 ? "" : "s"}; renaming updates them.` : "Used in expressions, exports and imports."}
    >
      <Input
        id="fe-key"
        value={value}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (problem) setDraft(null);
          else commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") setDraft(null);
        }}
        aria-invalid={problem || error ? true : undefined}
        className="h-7 font-mono text-xs"
      />
    </Row>
  );
}

export function FieldEditor({
  schema,
  field,
  errors,
  onChange,
  onRename,
  onLabelChange,
  onDuplicate,
  onDelete,
}: {
  schema: FormSchema;
  field: Field;
  errors: PropErrors;
  onChange(schema: FormSchema): void;
  onRename(oldKey: string, newKey: string): void;
  /** Label edits go through here so the page can auto-derive the key of new fields. */
  onLabelChange(label: string): void;
  onDuplicate(): void;
  onDelete(): void;
}) {
  const f = field as Field & Record<string, unknown>;
  const set = (prop: string, value: unknown) => onChange(setFieldProp(schema, field.key, prop, value));
  const valueFields = allFields(schema).map((l) => l.field);
  const isInput = field.type !== "calculated" && field.type !== "info";
  const hasUnit = ["number", "scale", "duration", "calculated", "text"].includes(field.type);

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2">
        <FieldTypeIcon type={field.type} className="size-4" />
        <h2 className="flex-1 truncate text-sm font-semibold">{field.label || field.key}</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Duplicate field" title="Duplicate" onClick={onDuplicate}>
          <Copy />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Delete field" title="Delete" onClick={onDelete} className="text-destructive hover:text-destructive">
          <Trash2 />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Row label={field.type === "info" ? "Heading" : "Label"} htmlFor="fe-label" error={errors.label} className="sm:col-span-2">
          <Input id="fe-label" value={field.label ?? ""} onChange={(e) => onLabelChange(e.target.value)} className="h-7" />
        </Row>
        <KeyInput key={field.key} schema={schema} field={field} onRename={onRename} error={errors.key} />
        <Row label="Type" htmlFor="fe-type" error={errors.type}>
          <NativeSelect id="fe-type" size="sm" value={field.type} onChange={(e) => onChange(changeFieldType(schema, field.key, e.target.value as FieldType))}>
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </Row>
        <Row label={field.type === "info" ? "Body (markdown)" : "Help text (markdown)"} htmlFor="fe-help" className="sm:col-span-2">
          <Textarea id="fe-help" rows={field.type === "info" ? 4 : 2} value={(f.help as string) ?? ""} onChange={(e) => set("help", e.target.value)} />
        </Row>
        {isInput && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Switch checked={field.required === true} onCheckedChange={(v) => set("required", v ? true : undefined)} aria-label="Required" />
            Required <span className="text-xs text-muted-foreground">(only when visible)</span>
          </label>
        )}
        {hasUnit && (
          <Row label="Unit" htmlFor="fe-unit" hint="Display only, e.g. kg, min, AU">
            <Input id="fe-unit" value={(f.unit as string) ?? ""} onChange={(e) => set("unit", e.target.value)} className="h-7" />
          </Row>
        )}
      </div>

      <TypeSpecific schema={schema} field={field} errors={errors} set={set} valueFields={valueFields} />

      <div className="grid gap-1.5 border-t pt-4">
        <Label htmlFor="fe-visible" className="text-xs text-muted-foreground">
          Show only if <span className="font-normal">(expression; empty = always shown)</span>
        </Label>
        <ExpressionInput
          id="fe-visible"
          value={(f.visible_if as string) ?? ""}
          onChange={(v) => set("visible_if", v === "" ? undefined : v)}
          fields={valueFields}
          selfKey={field.key}
          placeholder="e.g. has_pain == true"
          rows={1}
          optional
          serverError={errors.visible_if}
        />
      </div>
    </div>
  );
}

function TypeSpecific({
  schema,
  field,
  errors,
  set,
  valueFields,
}: {
  schema: FormSchema;
  field: Field;
  errors: PropErrors;
  set(prop: string, value: unknown): void;
  valueFields: Field[];
}) {
  const f = field as Field & Record<string, unknown>;
  void schema;
  switch (field.type) {
    case "number":
      return (
        <PropGroup title="Number">
          <Row label="Minimum" htmlFor="fe-min" error={errors.min}><NumberProp id="fe-min" value={f.min} onChange={(v) => set("min", v)} /></Row>
          <Row label="Maximum" htmlFor="fe-max" error={errors.max}><NumberProp id="fe-max" value={f.max} onChange={(v) => set("max", v)} /></Row>
          <Row label="Step" htmlFor="fe-step" error={errors.step}><NumberProp id="fe-step" value={f.step} placeholder="any" onChange={(v) => set("step", v)} /></Row>
          <Row label="Decimals" htmlFor="fe-dec" error={errors.decimals} hint="Display and input hint"><NumberProp id="fe-dec" value={f.decimals} onChange={(v) => set("decimals", v)} /></Row>
        </PropGroup>
      );
    case "scale": {
      const anchors = (f.anchors as Record<string, string> | undefined) ?? {};
      const setAnchor = (k: "min" | "mid" | "max", v: string) => {
        const next = { ...anchors, [k]: v };
        if (!v) delete next[k];
        set("anchors", Object.keys(next).length ? next : undefined);
      };
      return (
        <PropGroup title="Scale">
          <Row label="From" htmlFor="fe-min" error={errors.min}><NumberProp id="fe-min" value={f.min} onChange={(v) => set("min", v)} /></Row>
          <Row label="To" htmlFor="fe-max" error={errors.max}><NumberProp id="fe-max" value={f.max} onChange={(v) => set("max", v)} /></Row>
          <Row label="Step" htmlFor="fe-step" error={errors.step}><NumberProp id="fe-step" value={f.step} placeholder="1" onChange={(v) => set("step", v)} /></Row>
          <Row label="Display" htmlFor="fe-display">
            <NativeSelect id="fe-display" size="sm" value={(f.display as string) ?? ""} onChange={(e) => set("display", e.target.value || undefined)}>
              <option value="">Automatic</option>
              <option value="buttons">Buttons</option>
              <option value="slider">Slider</option>
            </NativeSelect>
          </Row>
          <Row label="Low anchor" htmlFor="fe-a-min" className="col-span-2"><Input id="fe-a-min" className="h-7" value={anchors.min ?? ""} onChange={(e) => setAnchor("min", e.target.value)} placeholder="e.g. Very, very good" /></Row>
          <Row label="Middle anchor" htmlFor="fe-a-mid" className="col-span-2"><Input id="fe-a-mid" className="h-7" value={anchors.mid ?? ""} onChange={(e) => setAnchor("mid", e.target.value)} /></Row>
          <Row label="High anchor" htmlFor="fe-a-max" className="col-span-2"><Input id="fe-a-max" className="h-7" value={anchors.max ?? ""} onChange={(e) => setAnchor("max", e.target.value)} placeholder="e.g. Very, very bad" /></Row>
          {errors.anchors && <p className="col-span-full text-xs text-destructive">{errors.anchors}</p>}
        </PropGroup>
      );
    }
    case "select":
    case "multiselect":
      return (
        <div className="grid gap-3 border-t pt-4">
          <h3 className="text-xs font-medium text-muted-foreground">Options</h3>
          <OptionsEditor id="fe-options" options={(f.options as FieldOption[]) ?? []} onChange={(o) => set("options", o)} error={errors.options} />
          {field.type === "select" && <p className="text-xs text-muted-foreground">Up to 5 options show as buttons, more as a dropdown.</p>}
          {field.type === "multiselect" && (
            <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
              <Row label="Min selected" htmlFor="fe-minsel" error={errors.min_selected}><NumberProp id="fe-minsel" value={f.min_selected} onChange={(v) => set("min_selected", v)} /></Row>
              <Row label="Max selected" htmlFor="fe-maxsel" error={errors.max_selected}><NumberProp id="fe-maxsel" value={f.max_selected} onChange={(v) => set("max_selected", v)} /></Row>
            </div>
          )}
        </div>
      );
    case "text":
    case "textarea":
      return (
        <PropGroup title="Text">
          <Row label="Max length" htmlFor="fe-maxlen" error={errors.max_length}>
            <NumberProp id="fe-maxlen" value={f.max_length} placeholder={field.type === "text" ? "500" : "5000"} onChange={(v) => set("max_length", v)} />
          </Row>
        </PropGroup>
      );
    case "date":
      return (
        <PropGroup title="Date range">
          <Row label="Earliest" htmlFor="fe-dmin" error={errors.min}><Input id="fe-dmin" type="date" className="h-7" value={(f.min as string) ?? ""} onChange={(e) => set("min", e.target.value || undefined)} /></Row>
          <Row label="Latest" htmlFor="fe-dmax" error={errors.max}><Input id="fe-dmax" type="date" className="h-7" value={(f.max as string) ?? ""} onChange={(e) => set("max", e.target.value || undefined)} /></Row>
        </PropGroup>
      );
    case "duration":
      return (
        <PropGroup title="Duration (minutes)">
          <Row label="Minimum" htmlFor="fe-min" error={errors.min}><NumberProp id="fe-min" value={f.min} onChange={(v) => set("min", v)} /></Row>
          <Row label="Maximum" htmlFor="fe-max" error={errors.max}><NumberProp id="fe-max" value={f.max} onChange={(v) => set("max", v)} /></Row>
        </PropGroup>
      );
    case "calculated":
      return (
        <div className="grid gap-3 border-t pt-4">
          <div className="grid gap-1.5">
            <Label htmlFor="fe-expr" className="text-xs text-muted-foreground">
              Expression
            </Label>
            <ExpressionInput
              id="fe-expr"
              value={(f.expression as string) ?? ""}
              onChange={(v) => set("expression", v)}
              fields={valueFields}
              selfKey={field.key}
              placeholder="e.g. sum(sleep_quality, fatigue, stress, soreness)"
              rows={3}
              serverError={errors.expression}
            />
          </div>
          <div className="grid max-w-40 gap-1.5">
            <Row label="Round to decimals" htmlFor="fe-dec" error={errors.decimals}>
              <NumberProp id="fe-dec" value={f.decimals} placeholder="none" onChange={(v) => set("decimals", v)} />
            </Row>
          </div>
        </div>
      );
    default:
      return null;
  }
}

function PropGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-t pt-4">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
    </div>
  );
}

export function SectionEditor({
  schema,
  section,
  index,
  errors,
  onChange,
  onDelete,
}: {
  schema: FormSchema;
  section: Section;
  index: number;
  errors: PropErrors;
  onChange(patch: Partial<Section>): void;
  onDelete(): void;
}) {
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const fieldsElsewhere = schema.sections.filter((_, i) => i !== index).flatMap((s) => s.fields);
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 truncate text-sm font-semibold">Section · {section.title || section.key}</h2>
        <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
          <Trash2 /> Delete section
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Title" htmlFor="se-title" error={errors.title} className="sm:col-span-2">
          <Input id="se-title" className="h-7" value={section.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} />
        </Row>
        <Row label="Key" htmlFor="se-key" error={errors.key}>
          <Input
            id="se-key"
            className="h-7 font-mono text-xs"
            value={keyDraft ?? section.key}
            onChange={(e) => setKeyDraft(e.target.value)}
            onBlur={() => {
              if (keyDraft !== null && keyDraft !== section.key) onChange({ key: keyDraft });
              setKeyDraft(null);
            }}
          />
        </Row>
        <Row label="Description (markdown)" htmlFor="se-desc" className="sm:col-span-2">
          <Textarea id="se-desc" rows={2} value={section.description ?? ""} onChange={(e) => onChange({ description: e.target.value || null })} />
        </Row>
      </div>
      {errors.fields && <p className="text-xs text-destructive">{errors.fields}</p>}
      <div className="grid gap-1.5 border-t pt-4">
        <Label htmlFor="se-visible" className="text-xs text-muted-foreground">
          Show section only if <span className="font-normal">(may not refer to fields in this section)</span>
        </Label>
        <ExpressionInput
          id="se-visible"
          value={section.visible_if ?? ""}
          onChange={(v) => onChange({ visible_if: v === "" ? null : v })}
          fields={fieldsElsewhere}
          rows={1}
          optional
          placeholder="e.g. session_type != 'rest'"
          serverError={errors.visible_if}
        />
      </div>
    </div>
  );
}
