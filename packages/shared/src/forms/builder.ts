/**
 * Helpers for the web form builder. All functions are pure: they return new schema
 * objects and share untouched sections/fields with the input.
 */
import { parse, references, renameIdentifier, isReservedWord } from "../expr";
import { KEY_MAX_LENGTH, KEY_PATTERN, allFields } from "./fields";
import type { Field, FieldOfType, FieldType, FormSchema, Section } from "./types";

export function emptySchema(): FormSchema {
  return { schema_version: 1, sections: [] };
}

export function newSection(key: string, title = "New section"): Section {
  return { key, title, fields: [] };
}

/** Default label per field type, used by `newField`. */
export const FIELD_TYPE_LABELS: Readonly<Record<FieldType, string>> = Object.freeze({
  number: "Number",
  scale: "Scale",
  select: "Single choice",
  multiselect: "Multiple choice",
  boolean: "Yes / no",
  text: "Short text",
  textarea: "Long text",
  date: "Date",
  time: "Time",
  datetime: "Date and time",
  duration: "Duration",
  calculated: "Calculated",
  info: "Information",
});

/** A valid field of the given type with sensible defaults (passes `validateSchema`). */
export function newField<T extends FieldType>(type: T, key: string, label?: string): FieldOfType<T> {
  const base = { key, type, label: label ?? FIELD_TYPE_LABELS[type] };
  const options = () => [
    { value: "option_1", label: "Option 1" },
    { value: "option_2", label: "Option 2" },
  ];
  let field: Field;
  switch (type as FieldType) {
    case "scale":
      field = { ...base, type: "scale", min: 1, max: 10, step: 1 };
      break;
    case "select":
      field = { ...base, type: "select", options: options() };
      break;
    case "multiselect":
      field = { ...base, type: "multiselect", options: options() };
      break;
    case "duration":
      field = { ...base, type: "duration", min: 0, unit: "min" };
      break;
    case "calculated":
      field = { ...base, type: "calculated", expression: "0" };
      break;
    default:
      field = base as Field;
  }
  return field as FieldOfType<T>;
}

/**
 * Turns a label into a valid key (`^[a-z][a-z0-9_]{0,62}$`, not reserved) that is not in
 * `existingKeys`: accents are stripped, other characters become `_`, a leading digit
 * gets an `f_` prefix, and `_2`, `_3`, ... is appended on collision.
 */
export function slugifyKey(label: string, existingKeys: Iterable<string> = []): string {
  let s = String(label);
  if (typeof s.normalize === "function") {
    try {
      s = s.normalize("NFKD");
    } catch {
      /* Hermes builds without ICU normalisation */
    }
  }
  s = s
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[æ]/g, "ae")
    .replace(/[ø]/g, "o")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (s === "") s = "field";
  if (!/^[a-z]/.test(s)) s = `f_${s}`;
  s = trimKey(s, KEY_MAX_LENGTH);
  return uniqueKey(s, existingKeys);
}

function trimKey(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max).replace(/_+$/, "");
}

/** `base` if free (and valid), else `base_2`, `base_3`, ... kept within 63 characters. */
export function uniqueKey(base: string, existingKeys: Iterable<string> = []): string {
  const taken = new Set(existingKeys);
  const free = (k: string) => !taken.has(k) && !isReservedWord(k) && KEY_PATTERN.test(k);
  if (free(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = trimKey(base, KEY_MAX_LENGTH - suffix.length) + suffix;
    if (free(candidate)) return candidate;
  }
}

/** Every key used by a field or a section (for uniqueness checks). */
export function usedKeys(schema: FormSchema): { fields: string[]; sections: string[] } {
  return {
    fields: allFields(schema).map((l) => l.field.key),
    sections: schema.sections.map((s) => s.key),
  };
}

function mapSections(schema: FormSchema, fn: (s: Section, i: number) => Section): FormSchema {
  let changed = false;
  const sections = schema.sections.map((s, i) => {
    const next = fn(s, i);
    if (next !== s) changed = true;
    return next;
  });
  return changed ? { ...schema, sections } : schema;
}

function clampIndex(i: number, length: number): number {
  if (!isFinite(i)) return length;
  return Math.max(0, Math.min(length, Math.trunc(i)));
}

export function insertSection(schema: FormSchema, section: Section, index = schema.sections.length): FormSchema {
  const sections = schema.sections.slice();
  sections.splice(clampIndex(index, sections.length), 0, section);
  return { ...schema, sections };
}

export function removeSection(schema: FormSchema, sectionIndex: number): FormSchema {
  if (sectionIndex < 0 || sectionIndex >= schema.sections.length) return schema;
  return { ...schema, sections: schema.sections.filter((_, i) => i !== sectionIndex) };
}

export function updateSection(
  schema: FormSchema,
  sectionIndex: number,
  patch: Partial<Section> | ((s: Section) => Section),
): FormSchema {
  return mapSections(schema, (s, i) => (i !== sectionIndex ? s : typeof patch === "function" ? patch(s) : { ...s, ...patch }));
}

export function moveSection(schema: FormSchema, from: number, to: number): FormSchema {
  const n = schema.sections.length;
  if (from < 0 || from >= n) return schema;
  const target = clampIndex(to, n - 1);
  if (target === from) return schema;
  const sections = schema.sections.slice();
  const [moved] = sections.splice(from, 1);
  sections.splice(target, 0, moved!);
  return { ...schema, sections };
}

/** Inserts `field` into a section at `index` (default: the end). */
export function insertField(schema: FormSchema, sectionIndex: number, field: Field, index?: number): FormSchema {
  return mapSections(schema, (s, i) => {
    if (i !== sectionIndex) return s;
    const fields = s.fields.slice();
    fields.splice(clampIndex(index ?? fields.length, fields.length), 0, field);
    return { ...s, fields };
  });
}

/** Removes the field with `key` (does not touch expressions that refer to it; see `findReferences`). */
export function removeField(schema: FormSchema, key: string): FormSchema {
  return mapSections(schema, (s) => {
    if (!s.fields.some((f) => f.key === key)) return s;
    return { ...s, fields: s.fields.filter((f) => f.key !== key) };
  });
}

/**
 * Replaces the field with `key` by `patch(field)` or `{...field, ...patch}`. Changing the
 * key this way does not update expressions; use `renameField` for that.
 */
export function updateField(
  schema: FormSchema,
  key: string,
  patch: Partial<Field> | ((f: Field) => Field),
): FormSchema {
  return mapSections(schema, (s) => {
    if (!s.fields.some((f) => f.key === key)) return s;
    return {
      ...s,
      fields: s.fields.map((f) => (f.key !== key ? f : typeof patch === "function" ? patch(f) : ({ ...f, ...patch } as Field))),
    };
  });
}

/**
 * Moves the field with `key` to `toSectionIndex` at `toIndex`, where `toIndex` is the
 * position in the target section after the field has been taken out (so moving within a
 * section to its own index is a no-op). Out-of-range indexes are clamped.
 */
export function moveField(schema: FormSchema, key: string, toSectionIndex: number, toIndex: number): FormSchema {
  const loc = allFields(schema).find((l) => l.field.key === key);
  if (!loc || toSectionIndex < 0 || toSectionIndex >= schema.sections.length) return schema;
  if (loc.sectionIndex === toSectionIndex) {
    const fields = loc.section.fields;
    const target = clampIndex(toIndex, fields.length - 1);
    if (target === loc.fieldIndex) return schema;
  }
  const sections = schema.sections.map((s) => ({ ...s, fields: s.fields.slice() }));
  const [field] = sections[loc.sectionIndex]!.fields.splice(loc.fieldIndex, 1);
  const dest = sections[toSectionIndex]!.fields;
  dest.splice(clampIndex(toIndex, dest.length), 0, field!);
  return {
    ...schema,
    sections: sections.map((s, i) =>
      i === loc.sectionIndex || i === toSectionIndex ? s : schema.sections[i]!,
    ),
  };
}

function renameIn(src: string | null | undefined, oldKey: string, newKey: string): string | null | undefined {
  return typeof src === "string" ? renameIdentifier(src, oldKey, newKey) : src;
}

/**
 * Rewrites references to `oldKey` in every expression of the schema (calculated
 * `expression`, field and section `visible_if`) to `newKey`, using source positions.
 * Field keys themselves are not changed (see `renameField`).
 */
export function renameKeyInExpressions(schema: FormSchema, oldKey: string, newKey: string): FormSchema {
  if (oldKey === newKey) return schema;
  return mapSections(schema, (s) => {
    let changed = false;
    const fields = s.fields.map((f) => {
      let next: Field = f;
      if (typeof f.visible_if === "string") {
        const v = renameIn(f.visible_if, oldKey, newKey);
        if (v !== f.visible_if) next = { ...next, visible_if: v } as Field;
      }
      if (f.type === "calculated" && typeof f.expression === "string") {
        const e = renameIdentifier(f.expression, oldKey, newKey);
        if (e !== f.expression) next = { ...next, expression: e } as Field;
      }
      if (next !== f) changed = true;
      return next;
    });
    let section: Section = changed ? { ...s, fields } : s;
    if (typeof s.visible_if === "string") {
      const v = renameIn(s.visible_if, oldKey, newKey);
      if (v !== s.visible_if) section = { ...section, visible_if: v ?? null };
    }
    return section;
  });
}

/** Changes a field's key and every expression reference to it. */
export function renameField(schema: FormSchema, oldKey: string, newKey: string): FormSchema {
  if (oldKey === newKey) return schema;
  const renamed = updateField(schema, oldKey, (f) => ({ ...f, key: newKey }));
  return renameKeyInExpressions(renamed, oldKey, newKey);
}

export interface ExpressionReference {
  /** Schema-validation style path of the expression, e.g. `sections/0/fields/3/expression`. */
  path: string;
  /** Key of the field (or section, when `section` is true) that owns the expression. */
  owner: string;
  section: boolean;
  property: "expression" | "visible_if";
}

/** Expressions that refer to `key` (e.g. to warn before deleting a field). Unparsable expressions are skipped. */
export function findReferences(schema: FormSchema, key: string): ExpressionReference[] {
  const out: ExpressionReference[] = [];
  const refersTo = (src: unknown): boolean => {
    if (typeof src !== "string") return false;
    const r = parse(src);
    return r.ok && references(r.ast).indexOf(key) !== -1;
  };
  schema.sections.forEach((s, si) => {
    if (refersTo(s.visible_if)) {
      out.push({ path: `sections/${si}/visible_if`, owner: s.key, section: true, property: "visible_if" });
    }
    s.fields.forEach((f, fi) => {
      if (f.type === "calculated" && refersTo(f.expression)) {
        out.push({ path: `sections/${si}/fields/${fi}/expression`, owner: f.key, section: false, property: "expression" });
      }
      if (refersTo(f.visible_if)) {
        out.push({ path: `sections/${si}/fields/${fi}/visible_if`, owner: f.key, section: false, property: "visible_if" });
      }
    });
  });
  return out;
}
