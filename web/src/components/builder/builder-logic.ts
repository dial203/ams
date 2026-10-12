/** Pure helpers for the form builder on top of the @ams/shared builder functions. */
import { arrayMove } from "@dnd-kit/sortable";
import {
  FIELD_TYPE_LABELS,
  allFields,
  insertField,
  insertSection,
  moveField,
  moveSection,
  newField,
  newSection,
  parse,
  references,
  slugifyKey,
  uniqueKey,
  updateField,
  usedKeys,
  type Field,
  type FieldType,
  type FormSchema,
  type SchemaError,
} from "@ams/shared";

export type Selection = { kind: "field"; key: string } | { kind: "section"; index: number } | null;

/** Adds a new field of `type` at the end of a section; returns the schema and the new key. */
export function addField(schema: FormSchema, sectionIndex: number, type: FieldType, index?: number): { schema: FormSchema; key: string } {
  const key = slugifyKey(FIELD_TYPE_LABELS[type], usedKeys(schema).fields);
  const field = newField(type, key);
  return { schema: insertField(schema, sectionIndex, field, index), key };
}

export function addSection(schema: FormSchema): { schema: FormSchema; index: number } {
  const key = uniqueKey(`section_${schema.sections.length + 1}`, usedKeys(schema).sections);
  return { schema: insertSection(schema, newSection(key, `Section ${schema.sections.length + 1}`)), index: schema.sections.length };
}

/** Copies a field next to itself with a fresh key. */
export function duplicateField(schema: FormSchema, key: string): { schema: FormSchema; key: string } | null {
  const loc = allFields(schema).find((l) => l.field.key === key);
  if (!loc) return null;
  const nextKey = uniqueKey(`${key}_copy`, usedKeys(schema).fields);
  const copy = { ...structuredCloneSafe(loc.field), key: nextKey, label: `${loc.field.label} (copy)` } as Field;
  return { schema: insertField(schema, loc.sectionIndex, copy, loc.fieldIndex + 1), key: nextKey };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const COMMON_KEYS = ["key", "label", "help", "required", "visible_if", "unit"] as const;

/**
 * Changes a field's type, keeping the common properties (label, help, required,
 * visible_if, unit) and options when both types have them; type-specific keys get the
 * new type's defaults.
 */
export function changeFieldType(schema: FormSchema, key: string, type: FieldType): FormSchema {
  return updateField(schema, key, (f) => {
    const fresh = newField(type, f.key, f.label) as unknown as Record<string, unknown>;
    const old = f as unknown as Record<string, unknown>;
    for (const k of COMMON_KEYS) if (old[k] !== undefined) fresh[k] = old[k];
    if ((type === "select" || type === "multiselect") && Array.isArray(old.options)) fresh.options = old.options;
    if ((type === "number" || type === "duration" || type === "scale") && typeof old.min === "number") fresh.min = old.min;
    if ((type === "number" || type === "duration" || type === "scale") && typeof old.max === "number") fresh.max = old.max;
    if (type === "calculated" || type === "info") delete fresh.required;
    return fresh as unknown as Field;
  });
}

/** Sets or removes (`undefined`/`""`/`null`) a property of a field. */
export function setFieldProp(schema: FormSchema, key: string, prop: string, value: unknown): FormSchema {
  return updateField(schema, key, (f) => {
    const next = { ...f } as Field & Record<string, unknown>;
    if (value === undefined || value === "" || value === null) delete next[prop];
    else next[prop] = value;
    return next as Field;
  });
}

export function fieldPath(schema: FormSchema, key: string): string | null {
  return allFields(schema).find((l) => l.field.key === key)?.path ?? null;
}

/** Errors that belong to a field (its path or below), with the sub-path (e.g. "expression"). */
export function errorsForField(errors: readonly SchemaError[], path: string | null): { prop: string; message: string }[] {
  if (!path) return [];
  return errors
    .filter((e) => e.path === path || e.path.startsWith(`${path}/`))
    .map((e) => ({ prop: e.path.slice(path.length + 1), message: e.message }));
}

/** Errors on a section itself (not on its fields). */
export function errorsForSection(errors: readonly SchemaError[], index: number): { prop: string; message: string }[] {
  const p = `sections/${index}`;
  return errors
    .filter((e) => e.path === p || (e.path.startsWith(`${p}/`) && !e.path.startsWith(`${p}/fields/`)))
    .map((e) => ({ prop: e.path.slice(p.length + 1), message: e.message }));
}

/** Errors that do not point to a section or field (e.g. `schema_version`). */
export function globalErrors(errors: readonly SchemaError[]): SchemaError[] {
  return errors.filter((e) => !e.path.startsWith("sections/") );
}

/** The selection an error path points to. */
export function selectionForPath(schema: FormSchema, path: string): Selection {
  const m = /^sections\/(\d+)(?:\/fields\/(\d+))?/.exec(path);
  if (!m) return null;
  const si = Number(m[1]);
  if (m[2] !== undefined) {
    const f = schema.sections[si]?.fields[Number(m[2])];
    return f ? { kind: "field", key: f.key } : { kind: "section", index: si };
  }
  return schema.sections[si] ? { kind: "section", index: si } : null;
}

/** Human-readable location of an error path: "Hooper index › expression". */
export function describePath(schema: FormSchema, path: string): string {
  const m = /^sections\/(\d+)(?:\/fields\/(\d+))?(?:\/(.+))?$/.exec(path);
  if (!m) return path || "Schema";
  const section = schema.sections[Number(m[1])];
  const field = m[2] !== undefined ? section?.fields[Number(m[2])] : undefined;
  const where = field ? field.label || field.key : (section?.title ?? `Section ${Number(m[1]) + 1}`);
  return m[3] ? `${where} › ${m[3].replace(/_/g, " ")}` : where;
}

export interface ExpressionCheck {
  ok: boolean;
  message: string | null;
  position?: number;
  end?: number;
}

/** Parse + reference check for the live error display. */
export function checkExpression(src: string, fields: readonly Field[], selfKey?: string): ExpressionCheck {
  if (src.trim() === "") return { ok: false, message: "Enter an expression" };
  const r = parse(src);
  if (!r.ok) return { ok: false, message: r.error.message, position: r.error.position, end: r.error.end };
  const known = new Map(fields.map((f) => [f.key, f]));
  for (const ref of references(r.ast)) {
    if (ref === selfKey) return { ok: false, message: `Refers to itself (${ref})` };
    const f = known.get(ref);
    if (!f) return { ok: false, message: `Unknown field "${ref}"` };
    if (f.type === "info") return { ok: false, message: `"${ref}" is an information block and has no value` };
  }
  return { ok: true, message: null };
}


export type OutlineItem =
  | { kind: "section"; id: string; si: number }
  | { kind: "field"; id: string; si: number; fi: number; key: string };

export function flattenOutline(schema: FormSchema): OutlineItem[] {
  const items: OutlineItem[] = [];
  schema.sections.forEach((s, si) => {
    items.push({ kind: "section", id: `s-${si}`, si });
    s.fields.forEach((f, fi) => items.push({ kind: "field", id: `f-${si}-${fi}`, si, fi, key: f.key }));
  });
  return items;
}

/** Applies a drop of `activeId` onto `overId` in the flattened outline. */
export function applyOutlineDrop(schema: FormSchema, activeId: string, overId: string): FormSchema {
  const items = flattenOutline(schema);
  const from = items.findIndex((i) => i.id === activeId);
  const to = items.findIndex((i) => i.id === overId);
  if (from < 0 || to < 0 || from === to) return schema;
  const moved = arrayMove(items, from, to);
  const active = items[from]!;
  const pos = moved.findIndex((i) => i.id === activeId);
  if (active.kind === "field") {
    let targetSection = -1;
    let index = 0;
    for (let i = pos - 1; i >= 0; i--) {
      const it = moved[i]!;
      if (it.kind === "section") {
        targetSection = it.si;
        break;
      }
      index++;
    }
    if (targetSection < 0) {
      // Dropped above the first section header: first position of the first section.
      targetSection = 0;
      index = 0;
    }
    return moveField(schema, active.key, targetSection, index);
  }
  const headersBefore = moved.slice(0, pos).filter((i) => i.kind === "section").length;
  return moveSection(schema, active.si, headersBefore);
}

