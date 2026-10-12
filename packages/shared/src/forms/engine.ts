import { evaluate, parse, references, roundHalfAwayFromZero, valuesEqual } from "../expr";
import type { ParseResult, Value } from "../expr";
import { codePointLength, hasOwn, isRecord, setOwn } from "../util";
import { allFields, isEmptyValue, maxLengthOf, scaleStep } from "./fields";
import type { FieldLocation } from "./fields";
import type { ErrorCode, Field, FormSchema, FormValues } from "./types";

/** Result of `evaluateForm` (docs/FORMS.md "Form evaluation"). */
export interface FormEvaluation {
  /** Every field key -> visible. Includes `info` and `calculated` fields. */
  visible: Record<string, boolean>;
  /** Calculated field key -> value (`null` when hidden or on evaluation error). */
  computed: Record<string, Value>;
  /** Input values of visible fields that are not empty (`""` and `[]` count as empty). */
  values: FormValues;
}

/** Result of `validateSubmission`. `values`/`computed`/`visible` are those of `evaluateForm`. */
export interface SubmissionValidation extends FormEvaluation {
  ok: boolean;
  /** Field key -> first failing check. */
  errors: Record<string, ErrorCode>;
}

/** A schema prepared for repeated evaluation (expressions parsed, calculation order fixed). */
export interface CompiledForm {
  readonly schema: FormSchema;
  readonly fields: readonly FieldLocation[];
  /** Calculated field keys in evaluation order (topological, ties by schema order). */
  readonly calculationOrder: readonly string[];
  evaluate(values: FormValues | null | undefined): FormEvaluation;
  validate(values: FormValues | null | undefined): SubmissionValidation;
}

/** A visible_if or expression that is absent (`undefined`/`null`) is `null` here. */
function parseOptional(src: unknown): ParseResult | null {
  if (src === undefined || src === null) return null;
  if (typeof src !== "string") {
    return { ok: false, error: { message: "Expression must be a string", position: 0, end: 0 } };
  }
  return parse(src);
}

/** Evaluates; any parse or evaluation error yields `null`. */
function evalOrNull(parsed: ParseResult, env: Record<string, unknown>): Value {
  if (!parsed.ok) return null;
  const r = evaluate(parsed.ast, env);
  return r.ok ? r.value : null;
}

function roundDecimals(x: Value, d: unknown): Value {
  if (typeof d !== "number" || !isFinite(d) || typeof x !== "number") return x;
  const r = roundHalfAwayFromZero(x, d);
  return isFinite(r) ? r : null;
}

/** `""` and `[]` (and `undefined`) are treated as `null`. */
function normalizeInput(v: unknown): unknown {
  return isEmptyValue(v) ? null : v;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

interface CalcEntry {
  loc: FieldLocation;
  key: string;
  parsed: ParseResult;
  decimals: unknown;
}

/**
 * Topological order of calculated fields by their references to other calculated
 * fields; among ready fields the earliest in schema order goes first. Fields in or
 * behind a cycle (invalid schemas) are appended in schema order.
 */
function calculationOrder(calcs: CalcEntry[]): CalcEntry[] {
  const indexByKey = new Map<string, number>();
  calcs.forEach((c, i) => {
    if (!indexByKey.has(c.key)) indexByKey.set(c.key, i);
  });
  const deps = calcs.map((c) => {
    if (!c.parsed.ok) return [];
    const out: number[] = [];
    for (const ref of references(c.parsed.ast)) {
      const j = indexByKey.get(ref);
      if (j !== undefined) out.push(j);
    }
    return out;
  });
  const placed = calcs.map(() => false);
  const order: CalcEntry[] = [];
  for (;;) {
    let picked = -1;
    for (let i = 0; i < calcs.length; i++) {
      if (!placed[i] && deps[i]!.every((d) => placed[d])) {
        picked = i;
        break;
      }
    }
    if (picked === -1) break;
    placed[picked] = true;
    order.push(calcs[picked]!);
  }
  calcs.forEach((c, i) => {
    if (!placed[i]) order.push(c);
  });
  return order;
}

function newRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Plain object (normal prototype) copy of a null-prototype record, preserving key order. */
function plain<T>(rec: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(rec)) setOwn(out, k, rec[k]!);
  return out;
}

/**
 * Prepares a schema for evaluation. Tolerates invalid drafts: unparsable expressions
 * evaluate to `null` (calculations) or hide the field (`visible_if`).
 */
export function compileForm(schema: FormSchema): CompiledForm {
  const fields = allFields(schema).filter((l) => typeof l.field.key === "string");
  const inputs = fields.filter((l) => l.field.type !== "calculated" && l.field.type !== "info");
  const calcs: CalcEntry[] = fields
    .filter((l) => l.field.type === "calculated")
    .map((loc) => {
      const f = loc.field as Extract<Field, { type: "calculated" }>;
      const parsed = parseOptional(f.expression) ?? {
        ok: false as const,
        error: { message: "Missing expression", position: 0, end: 0 },
      };
      return { loc, key: f.key, parsed, decimals: f.decimals };
    });
  const order = calculationOrder(calcs);
  const fieldVisibility = fields.map((l) => parseOptional(l.field.visible_if));
  const sections = Array.isArray(schema?.sections) ? schema.sections : [];
  const sectionVisibility = sections.map((s) => (isRecord(s) ? parseOptional(s.visible_if) : null));
  const byKey = new Map<string, FieldLocation>();
  for (const l of fields) if (!byKey.has(l.field.key)) byKey.set(l.field.key, l);

  function evaluateValues(values: FormValues | null | undefined): FormEvaluation {
    const raw: Record<string, unknown> = isRecord(values) ? values : {};
    const input = newRecord<unknown>();
    for (const l of inputs) {
      setOwn(input, l.field.key, normalizeInput(hasOwn(raw, l.field.key) ? raw[l.field.key] : undefined));
    }

    let hidden = new Set<string>();
    let env = newRecord<unknown>();
    const maxIterations = fields.length + 1;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      env = newRecord<unknown>();
      for (const l of inputs) {
        const k = l.field.key;
        setOwn(env, k, hidden.has(k) ? null : input[k]);
      }
      for (const c of order) {
        setOwn(env, c.key, hidden.has(c.key) ? null : roundDecimals(evalOrNull(c.parsed, env), c.decimals));
      }
      const sectionVisible = sectionVisibility.map((p) => p === null || evalOrNull(p, env) === true);
      const newHidden = new Set<string>();
      fields.forEach((l, i) => {
        const own = fieldVisibility[i]!;
        if (sectionVisible[l.sectionIndex] === false || (own !== null && evalOrNull(own, env) !== true)) {
          newHidden.add(l.field.key);
        }
      });
      if (setsEqual(newHidden, hidden)) break;
      hidden = newHidden;
    }

    const visible: Record<string, boolean> = {};
    for (const l of fields) setOwn(visible, l.field.key, !hidden.has(l.field.key));
    const computed: Record<string, Value> = {};
    for (const c of calcs) setOwn(computed, c.key, (env[c.key] ?? null) as Value);
    const out: FormValues = {};
    for (const l of inputs) {
      const k = l.field.key;
      if (!hidden.has(k) && input[k] !== null) setOwn<unknown>(out, k, input[k]);
    }
    return { visible, computed, values: out };
  }

  function validateValues(values: FormValues | null | undefined): SubmissionValidation {
    const evaluation = evaluateValues(values);
    const raw: Record<string, unknown> = isRecord(values) ? values : {};
    const errors = newRecord<ErrorCode>();
    for (const l of inputs) {
      const k = l.field.key;
      if (!evaluation.visible[k]) continue;
      const code = validateFieldValue(l.field, hasOwn(raw, k) ? raw[k] : undefined);
      if (code !== null) setOwn(errors, k, code);
    }
    for (const k of Object.keys(raw)) {
      const l = byKey.get(k);
      if (l === undefined || l.field.type === "info") setOwn(errors, k, "unknown_field");
    }
    const errs = plain(errors);
    return { ok: Object.keys(errs).length === 0, errors: errs, ...evaluation };
  }

  return {
    schema,
    fields,
    calculationOrder: order.map((c) => c.key),
    evaluate: evaluateValues,
    validate: validateValues,
  };
}

/**
 * `evaluate(schema, values)` of docs/FORMS.md: visibility (fixed point), calculated
 * values and the retained input values. Compiles the schema on each call; use
 * `compileForm` when evaluating the same schema repeatedly.
 */
export function evaluateForm(schema: FormSchema, values: FormValues | null | undefined): FormEvaluation {
  return compileForm(schema).evaluate(values);
}

/**
 * `validate(schema, values)` of docs/FORMS.md: runs `evaluateForm`, then checks every
 * visible input field and reports unknown keys. Calculated keys in `values` are ignored.
 */
export function validateSubmission(schema: FormSchema, values: FormValues | null | undefined): SubmissionValidation {
  return compileForm(schema).validate(values);
}

// ---------------------------------------------------------------------------
// Per-field checks

const DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const TIME_RE = /^([0-9]{2}):([0-9]{2})$/;
const DATETIME_RE =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]{1,9})?)?(?:Z|[+-]([0-9]{2}):([0-9]{2}))$/;

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isRealDate(y: number, m: number, d: number): boolean {
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** `YYYY-MM-DD` and a real calendar date (year 0001-9999). */
export function isValidDateString(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  return m !== null && isRealDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** `HH:MM`, 24-hour, 00-23 and 00-59. */
export function isValidTimeString(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = TIME_RE.exec(s);
  return m !== null && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

/** ISO 8601 date-time with a mandatory offset (`Z` or `+HH:MM`), real date and time. */
export function isValidDateTimeString(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATETIME_RE.exec(s);
  if (m === null) return false;
  if (!isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) return false;
  if (Number(m[4]) > 23 || Number(m[5]) > 59) return false;
  if (m[6] !== undefined && Number(m[6]) > 59) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  return true;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

function optionValues(field: { options?: unknown }): unknown[] {
  if (!Array.isArray(field.options)) return [];
  return field.options.map((o: unknown) => (isRecord(o) ? o.value : undefined));
}

function inOptions(options: unknown[], v: unknown): boolean {
  for (const o of options) if (valuesEqual(o, v)) return true;
  return false;
}

/**
 * Checks one input value against its field, in the order of docs/FORMS.md; returns the
 * first failing code or `null`. Visibility is not considered here.
 */
export function validateFieldValue(field: Field, value: unknown): ErrorCode | null {
  const f = field as Field & Record<string, unknown>;
  // 1. required
  if (isEmptyValue(value)) return f.required === true ? "required" : null;

  // 2. JSON type
  switch (f.type) {
    case "number":
    case "scale":
    case "duration":
      if (!isFiniteNumber(value)) return "invalid_type";
      break;
    case "select":
      if (typeof value !== "string" && !isFiniteNumber(value)) return "invalid_type";
      break;
    case "multiselect":
      if (!Array.isArray(value)) return "invalid_type";
      break;
    case "boolean":
      if (typeof value !== "boolean") return "invalid_type";
      break;
    case "text":
    case "textarea":
    case "date":
    case "time":
    case "datetime":
      if (typeof value !== "string") return "invalid_type";
      break;
    default:
      return null;
  }

  // 3. format
  if (f.type === "date" && !isValidDateString(value)) return "invalid_format";
  if (f.type === "time" && !isValidTimeString(value)) return "invalid_format";
  if (f.type === "datetime" && !isValidDateTimeString(value)) return "invalid_format";

  // 4. options
  if (f.type === "select" && !inOptions(optionValues(f), value)) return "invalid_option";
  if (f.type === "multiselect") {
    const options = optionValues(f);
    const list = value as unknown[];
    for (let i = 0; i < list.length; i++) {
      if (!inOptions(options, list[i])) return "invalid_option";
      for (let j = 0; j < i; j++) if (valuesEqual(list[i], list[j])) return "invalid_option";
    }
  }

  // 5. scale grid
  if (f.type === "scale" && isFiniteNumber(f.min)) {
    const q = ((value as number) - f.min) / scaleStep(f);
    if (Math.abs(q - Math.round(q)) > 1e-9) return "invalid_step";
  }

  // 6. range
  if (f.type === "number" || f.type === "scale" || f.type === "duration") {
    const v = value as number;
    if ((isFiniteNumber(f.min) && v < f.min) || (isFiniteNumber(f.max) && v > f.max)) return "out_of_range";
  }
  if (f.type === "date") {
    const v = value as string;
    if ((typeof f.min === "string" && v < f.min) || (typeof f.max === "string" && v > f.max)) return "out_of_range";
  }
  if (f.type === "multiselect") {
    const n = (value as unknown[]).length;
    if ((isFiniteNumber(f.min_selected) && n < f.min_selected) || (isFiniteNumber(f.max_selected) && n > f.max_selected)) {
      return "out_of_range";
    }
  }

  // 7. length
  if ((f.type === "text" || f.type === "textarea") && codePointLength(value as string) > maxLengthOf(f)) {
    return "too_long";
  }
  return null;
}
