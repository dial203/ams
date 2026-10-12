/** Pure helpers for the team entry grid: cell parsing, paste handling and the bulk payload. */
import {
  valuesEqual,
  type BulkSubmissionCreate,
  type CompiledForm,
  type FormValues,
  type InputField,
} from "@ams/shared";
import { parseDurationInput, parseNumberInput } from "@/lib/field-format";

export type CellKey = `${number}:${number}`;

export function cellKey(row: number, col: number): CellKey {
  return `${row}:${col}`;
}

/**
 * Converts typed or pasted text to a field value. Returns `undefined` for empty input and
 * the raw string when it cannot be interpreted (so validation reports it).
 */
export function parseCellText(field: InputField, text: string): unknown {
  const t = text.trim();
  if (t === "") return undefined;
  switch (field.type) {
    case "number":
    case "scale":
      return parseNumberInput(t);
    case "duration":
      return parseDurationInput(t);
    case "boolean": {
      const l = t.toLowerCase();
      if (["y", "yes", "true", "1", "x", "✓"].includes(l)) return true;
      if (["n", "no", "false", "0"].includes(l)) return false;
      return t;
    }
    case "select": {
      const l = t.toLowerCase();
      const byLabel = field.options.find((o) => o.label.toLowerCase() === l);
      if (byLabel) return byLabel.value;
      const byValue = field.options.find((o) => String(o.value).toLowerCase() === l);
      if (byValue) return byValue.value;
      const n = parseNumberInput(t);
      const byNumber = typeof n === "number" ? field.options.find((o) => valuesEqual(o.value, n)) : undefined;
      return byNumber ? byNumber.value : t;
    }
    case "multiselect": {
      const parts = t.split(/[;,|]/).map((p) => p.trim()).filter(Boolean);
      return parts.map((p) => {
        const l = p.toLowerCase();
        const o = field.options.find((opt) => opt.label.toLowerCase() === l || String(opt.value).toLowerCase() === l);
        return o ? o.value : p;
      });
    }
    default:
      return t;
  }
}

/** Splits clipboard text (from a spreadsheet) into rows of cells. */
export function parseClipboard(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (normalized === "") return [];
  return normalized.split("\n").map((line) => line.split("\t"));
}

/** True when the paste should be spread over several cells (multi-line or tab-separated). */
export function isGridPaste(text: string): boolean {
  return /[\t\n]/.test(text.replace(/\r?\n$/, ""));
}

export function isRowEmpty(values: FormValues | undefined): boolean {
  if (!values) return true;
  return Object.keys(values).every((k) => {
    const v = values[k];
    return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  });
}

export interface GridRowState {
  athleteId: string;
  values: FormValues;
}

export interface PreparedSave {
  payload: BulkSubmissionCreate | null;
  /** Athlete ids of filled rows that fail client validation (not sent). */
  invalid: string[];
}

/**
 * Builds the bulk request from filled, unsaved rows that pass client validation. Values are
 * the engine's `values` (visible, non-empty inputs; calculated fields are recomputed by the
 * server).
 */
export function prepareBulkSave(
  compiled: CompiledForm,
  formId: string,
  date: string,
  rows: readonly GridRowState[],
  skip: ReadonlySet<string> = new Set(),
): PreparedSave {
  const entries: BulkSubmissionCreate["entries"] = [];
  const invalid: string[] = [];
  for (const row of rows) {
    if (skip.has(row.athleteId) || isRowEmpty(row.values)) continue;
    const r = compiled.validate(row.values);
    if (!r.ok) invalid.push(row.athleteId);
    else entries.push({ athlete_id: row.athleteId, values: r.values });
  }
  return {
    payload: entries.length > 0 ? { form_id: formId, local_date: date, entries } : null,
    invalid,
  };
}
