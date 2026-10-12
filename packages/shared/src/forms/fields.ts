import { isReservedWord, roundHalfAwayFromZero } from "../expr";
import { isRecord } from "../util";
import { FIELD_TYPES } from "./types";
import type {
  Field,
  FieldType,
  FormSchema,
  InputField,
  ScaleField,
  Section,
  ValueField,
} from "./types";

/** Field and section key pattern. */
export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
export const KEY_MAX_LENGTH = 63;

export const DEFAULT_TEXT_MAX_LENGTH = 500;
export const DEFAULT_TEXTAREA_MAX_LENGTH = 5000;

const fieldTypeSet = new Set<string>(FIELD_TYPES);

export function isFieldType(type: unknown): type is FieldType {
  return typeof type === "string" && fieldTypeSet.has(type);
}

/** A valid field key: matches `KEY_PATTERN` and is not a reserved word. */
export function isValidFieldKey(key: unknown): key is string {
  return typeof key === "string" && KEY_PATTERN.test(key) && !isReservedWord(key);
}

/** Holds a value (everything but `info`). */
export function isValueField(field: Pick<Field, "type">): field is ValueField {
  return field.type !== "info";
}

/** Takes input (everything but `calculated` and `info`). */
export function isInputField(field: Pick<Field, "type">): field is InputField {
  return field.type !== "info" && field.type !== "calculated";
}

/** `undefined`, `null`, `""` and `[]` count as "no value". */
export function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

export interface FieldLocation {
  field: Field;
  section: Section;
  sectionIndex: number;
  /** Index within the section. */
  fieldIndex: number;
  /** Index in schema order across all sections. */
  index: number;
  /** Schema-validation path prefix, e.g. `sections/0/fields/2`. */
  path: string;
}

function sectionsOf(schema: FormSchema | null | undefined): Section[] {
  if (!isRecord(schema) || !Array.isArray(schema.sections)) return [];
  return schema.sections;
}

/**
 * Every field in schema order with its location. Tolerates malformed drafts: entries
 * that are not objects are skipped.
 */
export function allFields(schema: FormSchema | null | undefined): FieldLocation[] {
  const out: FieldLocation[] = [];
  sectionsOf(schema).forEach((section, sectionIndex) => {
    if (!isRecord(section) || !Array.isArray(section.fields)) return;
    section.fields.forEach((field, fieldIndex) => {
      if (!isRecord(field)) return;
      out.push({
        field,
        section,
        sectionIndex,
        fieldIndex,
        index: out.length,
        path: `sections/${sectionIndex}/fields/${fieldIndex}`,
      });
    });
  });
  return out;
}

/** Every field key in schema order (including `info` and `calculated`). */
export function fieldKeys(schema: FormSchema | null | undefined): string[] {
  return allFields(schema).map((l) => l.field.key);
}

/** Fields that hold a value (not `info`), including `calculated`, in schema order. */
export function valueFields(schema: FormSchema | null | undefined): ValueField[] {
  return allFields(schema)
    .map((l) => l.field)
    .filter(isValueField);
}

/** Fields that take input (not `calculated`, not `info`), in schema order. */
export function inputFields(schema: FormSchema | null | undefined): InputField[] {
  return allFields(schema)
    .map((l) => l.field)
    .filter(isInputField);
}

/** `calculated` fields in schema order. */
export function calculatedFields(schema: FormSchema | null | undefined): Extract<Field, { type: "calculated" }>[] {
  return allFields(schema)
    .map((l) => l.field)
    .filter((f): f is Extract<Field, { type: "calculated" }> => f.type === "calculated");
}

export function findField(schema: FormSchema | null | undefined, key: string): FieldLocation | undefined {
  for (const loc of allFields(schema)) if (loc.field.key === key) return loc;
  return undefined;
}

/** Step of a scale (default 1). */
export function scaleStep(field: Pick<ScaleField, "step">): number {
  return typeof field.step === "number" && field.step > 0 ? field.step : 1;
}

/** The points of a scale, `min` to `max` by `step` (floating-point noise removed). */
export function scaleValues(field: Pick<ScaleField, "min" | "max" | "step">): number[] {
  const { min, max } = field;
  if (typeof min !== "number" || typeof max !== "number" || !(max >= min)) return [];
  const step = scaleStep(field);
  const n = Math.floor((max - min) / step + 1e-9) + 1;
  if (n > 10000) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(roundHalfAwayFromZero(min + i * step, 10));
  return out;
}

/** `display` of a scale, defaulting to buttons for at most 11 points, else slider. */
export function scaleDisplay(field: Pick<ScaleField, "min" | "max" | "step" | "display">): "buttons" | "slider" {
  if (field.display === "buttons" || field.display === "slider") return field.display;
  const n = scaleValues(field).length;
  return n > 0 && n <= 11 ? "buttons" : "slider";
}

/** Effective `max_length` of a text or textarea field. */
export function maxLengthOf(field: { type: string; max_length?: number }): number {
  if (typeof field.max_length === "number") return field.max_length;
  return field.type === "textarea" ? DEFAULT_TEXTAREA_MAX_LENGTH : DEFAULT_TEXT_MAX_LENGTH;
}
