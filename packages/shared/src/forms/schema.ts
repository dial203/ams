import { parse, references, valuesEqual } from "../expr";
import type { Expr } from "../expr";
import { isRecord } from "../util";
import { isValidDateString } from "./engine";
import { KEY_PATTERN, isFieldType, isValidFieldKey } from "./fields";
import type { SchemaError } from "./types";

/**
 * Schema validation (docs/FORMS.md "Schema validation"). Returns one error per
 * offending path (the first problem found there), in document order of detection.
 * An empty list means the schema can be published.
 *
 * Besides the rules in FORMS.md this checks that optional type-specific keys, when
 * present, are well-typed (e.g. `step > 0`, `decimals` an integer 0-10, `max_length` a
 * positive integer, date `min`/`max` real dates), since the engine relies on them.
 */
export function validateSchema(schema: unknown): SchemaError[] {
  const errors = new Map<string, string>();
  const add = (path: string, message: string): void => {
    if (!errors.has(path)) errors.set(path, message);
  };

  if (!isRecord(schema)) {
    add("", "Schema must be an object");
    return toList(errors);
  }
  if (schema.schema_version !== 1) add("schema_version", "schema_version must be 1");
  let sections: unknown[] = [];
  if (Array.isArray(schema.sections)) sections = schema.sections;
  else add("sections", "sections must be a list");

  interface FieldInfo {
    field: Record<string, unknown>;
    path: string;
    key: string | null;
    type: unknown;
    sectionIndex: number;
  }
  const fields: FieldInfo[] = [];
  const sectionKeys = new Set<string>();
  const fieldKeys = new Set<string>();

  // Pass 1: structure, keys, types, type-specific keys.
  sections.forEach((section, si) => {
    const sp = `sections/${si}`;
    if (!isRecord(section)) {
      add(sp, "Section must be an object");
      return;
    }
    const key = section.key;
    if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
      add(`${sp}/key`, "Section key must start with a lowercase letter and contain only a-z, 0-9 and _ (max 63)");
    } else if (sectionKeys.has(key)) {
      add(`${sp}/key`, `Duplicate section key '${key}'`);
    } else {
      sectionKeys.add(key);
    }
    if (typeof section.title !== "string") add(`${sp}/title`, "Section title is required");
    if (section.description !== undefined && section.description !== null && typeof section.description !== "string") {
      add(`${sp}/description`, "Description must be text");
    }
    if (!Array.isArray(section.fields) || section.fields.length === 0) {
      add(`${sp}/fields`, "A section needs at least one field");
    }
    const sectionFields: unknown[] = Array.isArray(section.fields) ? section.fields : [];
    sectionFields.forEach((field, fi) => {
      const fp = `${sp}/fields/${fi}`;
      if (!isRecord(field)) {
        add(fp, "Field must be an object");
        return;
      }
      let fkey: string | null = null;
      if (!isValidFieldKey(field.key)) {
        add(
          `${fp}/key`,
          typeof field.key === "string" && KEY_PATTERN.test(field.key)
            ? `'${field.key}' is a reserved word`
            : "Field key must start with a lowercase letter and contain only a-z, 0-9 and _ (max 63)",
        );
      } else if (fieldKeys.has(field.key)) {
        add(`${fp}/key`, `Duplicate field key '${field.key}'`);
        fkey = field.key;
      } else {
        fieldKeys.add(field.key);
        fkey = field.key;
      }
      if (!isFieldType(field.type)) add(`${fp}/type`, `Unknown field type '${String(field.type)}'`);
      if (typeof field.label !== "string") add(`${fp}/label`, "Label is required");
      checkFieldKeys(field, fp, add);
      fields.push({ field, path: fp, key: fkey, type: field.type, sectionIndex: si });
    });
  });

  // Keys that hold a value (any field that is not `info`) and `info` keys.
  const valueKeys = new Set<string>();
  const infoKeys = new Set<string>();
  for (const f of fields) {
    if (f.key === null) continue;
    if (f.type === "info") infoKeys.add(f.key);
    else valueKeys.add(f.key);
  }

  const checkRefs = (ast: Expr, path: string): boolean => {
    const unknown: string[] = [];
    const info: string[] = [];
    for (const ref of references(ast)) {
      if (infoKeys.has(ref) && !valueKeys.has(ref)) info.push(ref);
      else if (!valueKeys.has(ref)) unknown.push(ref);
    }
    if (unknown.length > 0) {
      add(path, `Unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
      return false;
    }
    if (info.length > 0) {
      add(path, `Info field${info.length > 1 ? "s hold" : " holds"} no value: ${info.join(", ")}`);
      return false;
    }
    return true;
  };

  const parseAt = (src: unknown, path: string): Expr | null => {
    if (typeof src !== "string") {
      add(path, "Expression must be text");
      return null;
    }
    const r = parse(src);
    if (!r.ok) {
      add(path, `${r.error.message} (at ${r.error.position + 1})`);
      return null;
    }
    return r.ast;
  };

  // Pass 2: expressions.
  const calcAsts = new Map<string, { ast: Expr; path: string }[]>();
  for (const f of fields) {
    if (f.type === "calculated") {
      const ep = `${f.path}/expression`;
      const src = f.field.expression;
      if (typeof src !== "string" || src.trim() === "") {
        add(ep, "A calculated field needs an expression");
      } else {
        const ast = parseAt(src, ep);
        if (ast) checkRefs(ast, ep);
        // Every parsed calculation joins the cycle graph, even with a bad reference,
        // so that all members of a cycle are reported.
        if (ast && f.key !== null) {
          const list = calcAsts.get(f.key) ?? [];
          list.push({ ast, path: ep });
          calcAsts.set(f.key, list);
        }
      }
    }
    const vis = f.field.visible_if;
    if (vis !== undefined && vis !== null) {
      const vp = `${f.path}/visible_if`;
      const ast = parseAt(vis, vp);
      if (ast && checkRefs(ast, vp) && f.key !== null && references(ast).indexOf(f.key) !== -1) {
        add(vp, "A field's visible_if cannot refer to the field itself");
      }
    }
  }
  sections.forEach((section, si) => {
    if (!isRecord(section)) return;
    const vis = section.visible_if;
    if (vis === undefined || vis === null) return;
    const vp = `sections/${si}/visible_if`;
    const ast = parseAt(vis, vp);
    if (!ast || !checkRefs(ast, vp)) return;
    const own = new Set(fields.filter((f) => f.sectionIndex === si && f.key !== null).map((f) => f.key!));
    const inside = references(ast).filter((r) => own.has(r));
    if (inside.length > 0) {
      add(vp, `A section's visible_if cannot refer to its own fields: ${inside.join(", ")}`);
    }
  });

  // Pass 3: cycles among calculated fields (Tarjan's strongly connected components).
  for (const cycle of calculationCycles(calcAsts)) {
    const text = cycle.keys.join(" -> ");
    for (const path of cycle.paths) add(path, `Circular calculation: ${text}`);
  }

  return toList(errors);
}

function toList(errors: Map<string, string>): SchemaError[] {
  const out: SchemaError[] = [];
  errors.forEach((message, path) => out.push({ path, message }));
  return out;
}

function calculationCycles(
  calcAsts: Map<string, { ast: Expr; path: string }[]>,
): { keys: string[]; paths: string[] }[] {
  const keys = Array.from(calcAsts.keys());
  const edges = new Map<string, string[]>();
  for (const k of keys) {
    const deps = new Set<string>();
    for (const { ast } of calcAsts.get(k)!) for (const r of references(ast)) if (calcAsts.has(r)) deps.add(r);
    edges.set(k, Array.from(deps));
  }

  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: { keys: string[]; paths: string[] }[] = [];

  const strongConnect = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v)!) {
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      const selfLoop = component.length === 1 && edges.get(v)!.indexOf(v) !== -1;
      if (component.length > 1 || selfLoop) {
        const ordered = keys.filter((k) => component.indexOf(k) !== -1);
        out.push({
          keys: selfLoop ? [v, v] : ordered.concat(ordered[0]!),
          paths: ordered.reduce<string[]>((acc, k) => acc.concat(calcAsts.get(k)!.map((c) => c.path)), []),
        });
      }
    }
  };
  for (const k of keys) if (!index.has(k)) strongConnect(k);
  return out;
}

type Add = (path: string, message: string) => void;

function isNumber(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

function isIntegerIn(v: unknown, lo: number, hi: number): boolean {
  return isNumber(v) && Number.isInteger(v) && v >= lo && v <= hi;
}

/** Type-specific keys: required ones (FORMS.md rule 3) and optional ones when present. */
function checkFieldKeys(field: Record<string, unknown>, fp: string, add: Add): void {
  const optionalNumber = (k: string): void => {
    if (field[k] !== undefined && !isNumber(field[k])) add(`${fp}/${k}`, `${k} must be a number`);
  };
  const optionalPositive = (k: string): void => {
    if (field[k] !== undefined && !(isNumber(field[k]) && (field[k] as number) > 0)) {
      add(`${fp}/${k}`, `${k} must be a number greater than 0`);
    }
  };
  const optionalCount = (k: string, min: number): void => {
    if (field[k] !== undefined && !isIntegerIn(field[k], min, Number.MAX_SAFE_INTEGER)) {
      add(`${fp}/${k}`, `${k} must be a whole number of at least ${min}`);
    }
  };
  const optionalDecimals = (): void => {
    if (field.decimals !== undefined && !isIntegerIn(field.decimals, 0, 10)) {
      add(`${fp}/decimals`, "decimals must be a whole number from 0 to 10");
    }
  };
  const minNotAboveMax = (): void => {
    if (isNumber(field.min) && isNumber(field.max) && field.min > field.max) {
      add(`${fp}/max`, "max must not be less than min");
    }
  };

  switch (field.type) {
    case "number":
      optionalNumber("min");
      optionalNumber("max");
      optionalPositive("step");
      optionalDecimals();
      minNotAboveMax();
      break;
    case "duration":
      optionalNumber("min");
      optionalNumber("max");
      minNotAboveMax();
      break;
    case "scale": {
      if (!isNumber(field.min)) add(`${fp}/min`, "A scale needs a numeric min");
      if (!isNumber(field.max)) add(`${fp}/max`, "A scale needs a numeric max");
      else if (isNumber(field.min) && field.min >= field.max) add(`${fp}/max`, "Scale max must be greater than min");
      optionalPositive("step");
      if (field.anchors !== undefined) {
        const a = field.anchors;
        if (!isRecord(a) || ["min", "max", "mid"].some((k) => a[k] !== undefined && typeof a[k] !== "string")) {
          add(`${fp}/anchors`, "anchors must be an object with optional text min, mid and max");
        }
      }
      if (field.display !== undefined && field.display !== "buttons" && field.display !== "slider") {
        add(`${fp}/display`, "display must be 'buttons' or 'slider'");
      }
      break;
    }
    case "select":
    case "multiselect": {
      const problem = optionsProblem(field.options);
      if (problem) add(`${fp}/options`, problem);
      if (field.type === "multiselect") {
        optionalCount("min_selected", 0);
        optionalCount("max_selected", 1);
        if (isNumber(field.min_selected) && isNumber(field.max_selected) && field.min_selected > field.max_selected) {
          add(`${fp}/max_selected`, "max_selected must not be less than min_selected");
        }
      }
      break;
    }
    case "text":
    case "textarea":
      optionalCount("max_length", 1);
      break;
    case "date":
      for (const k of ["min", "max"]) {
        if (field[k] !== undefined && !isValidDateString(field[k])) add(`${fp}/${k}`, `${k} must be a date (YYYY-MM-DD)`);
      }
      if (isValidDateString(field.min) && isValidDateString(field.max) && field.min > field.max) {
        add(`${fp}/max`, "max must not be before min");
      }
      break;
    case "calculated":
      optionalDecimals();
      break;
  }
}

function optionsProblem(options: unknown): string | null {
  if (!Array.isArray(options) || options.length === 0) return "Add at least one option";
  let kind: "string" | "number" | null = null;
  const seen: unknown[] = [];
  for (const o of options) {
    if (!isRecord(o) || typeof o.label !== "string") return "Every option needs a value and a label";
    const v = o.value;
    const k = typeof v === "string" ? "string" : isNumber(v) ? "number" : null;
    if (k === null) return "Option values must be text or numbers";
    if (kind !== null && k !== kind) return "Option values must be all text or all numbers";
    kind = k;
    if (seen.some((s) => valuesEqual(s, v))) return `Duplicate option value '${String(v)}'`;
    seen.push(v);
  }
  return null;
}
