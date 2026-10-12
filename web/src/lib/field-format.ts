/** Display and input conversion helpers for form field values. */
import { roundHalfAwayFromZero, valuesEqual, type Field, type FieldOption } from "@ams/shared";

export const EMPTY_TEXT = "–";

export function optionLabel(options: readonly FieldOption[] | undefined, value: unknown): string {
  const o = (options ?? []).find((opt) => valuesEqual(opt.value, value));
  return o ? o.label : String(value);
}

export function formatNumber(n: number, decimals?: number): string {
  if (!isFinite(n)) return EMPTY_TEXT;
  if (typeof decimals === "number" && decimals >= 0 && decimals <= 10) {
    return roundHalfAwayFromZero(n, decimals).toFixed(decimals);
  }
  // Trim floating-point noise (0.1 + 0.2) without forcing decimals.
  return String(roundHalfAwayFromZero(n, 10));
}

export function withUnit(text: string, unit: string | null | undefined): string {
  if (!unit) return text;
  return unit === "%" ? `${text}%` : `${text} ${unit}`;
}

/** "1 h 30 min" for minutes. */
export function formatDuration(minutes: number): string {
  if (!isFinite(minutes)) return EMPTY_TEXT;
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = roundHalfAwayFromZero(abs - h * 60, 2);
  if (h === 0) return `${sign}${m} min`;
  if (m === 0) return `${sign}${h} h`;
  return `${sign}${h} h ${m} min`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

/** Human-readable value of any field (input or calculated). Empty values give `EMPTY_TEXT`. */
export function formatFieldValue(field: Field, value: unknown): string {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    return EMPTY_TEXT;
  }
  switch (field.type) {
    case "select":
      return optionLabel(field.options, value);
    case "multiselect":
      return Array.isArray(value) ? value.map((v) => optionLabel(field.options, v)).join(", ") : String(value);
    case "boolean":
      return value === true ? "Yes" : value === false ? "No" : String(value);
    case "duration":
      return typeof value === "number" ? formatDuration(value) : String(value);
    case "number":
      return typeof value === "number" ? withUnit(formatNumber(value, field.decimals), field.unit) : String(value);
    case "scale":
      return typeof value === "number" ? withUnit(formatNumber(value), field.unit) : String(value);
    case "calculated":
      if (typeof value === "number") return withUnit(formatNumber(value, field.decimals), field.unit);
      if (typeof value === "boolean") return value ? "Yes" : "No";
      if (Array.isArray(value)) return value.join(", ");
      return withUnit(String(value), field.unit);
    case "datetime":
      return typeof value === "string" ? formatDateTime(value) : String(value);
    case "date":
      return typeof value === "string" ? formatDate(value) : String(value);
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

/** Compact value for dense tables (no unit for numbers, raw ISO dates). */
export function formatCellValue(field: Field | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return "";
  if (!field) return typeof value === "object" ? JSON.stringify(value) : String(value);
  switch (field.type) {
    case "number":
      return typeof value === "number" ? formatNumber(value, field.decimals) : String(value);
    case "calculated":
      if (typeof value === "number") return formatNumber(value, field.decimals);
      if (typeof value === "boolean") return value ? "Yes" : "No";
      return String(value);
    case "date":
    case "time":
      return String(value);
    default:
      return formatFieldValue(field, value);
  }
}

const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/**
 * Parses free-typed numeric input. Empty -> `undefined` (no value); a number -> number;
 * anything else is kept as the raw string so validation reports `invalid_type`.
 * Accepts a decimal comma.
 */
export function parseNumberInput(text: string): number | string | undefined {
  const t = text.trim().replace(/\s+/g, "");
  if (t === "") return undefined;
  const normalized = /^[-+]?\d+,\d+$/.test(t) ? t.replace(",", ".") : t;
  if (NUMBER_RE.test(normalized)) {
    const n = Number(normalized);
    if (isFinite(n)) return n;
  }
  return text;
}

/**
 * Parses a duration typed in one box: "90" (minutes), "1:30" or "1h30" / "1h 30m" (hours and
 * minutes), "1.5h". Returns minutes, `undefined` for empty, or the raw string when unparseable.
 */
export function parseDurationInput(text: string): number | string | undefined {
  const t = text.trim().toLowerCase();
  if (t === "") return undefined;
  let m = /^(\d+):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+(?:\.\d+)?)\s*(?:m(?:in)?)?)?$/.exec(t);
  if (m) return roundHalfAwayFromZero(Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0), 4);
  m = /^(\d+(?:\.\d+)?)\s*m(?:in)?$/.exec(t);
  if (m) return Number(m[1]);
  const n = parseNumberInput(t);
  return n;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `datetime-local` value ("YYYY-MM-DDTHH:MM") -> ISO 8601 with the browser's offset. */
export function localDateTimeToISO(local: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  if (isNaN(d.getTime())) return undefined;
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** ISO 8601 date-time -> `datetime-local` value in the browser's time zone. */
export function isoToLocalDateTime(iso: unknown): string {
  if (typeof iso !== "string" || iso === "") return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Range hint for numeric fields, e.g. "1–7" or "0–24 h". */
export function rangeHint(min: unknown, max: unknown, unit?: string | null): string | null {
  const lo = typeof min === "number" ? formatNumber(min) : null;
  const hi = typeof max === "number" ? formatNumber(max) : null;
  let text: string | null = null;
  if (lo !== null && hi !== null) text = `${lo}–${hi}`;
  else if (lo !== null) text = `≥ ${lo}`;
  else if (hi !== null) text = `≤ ${hi}`;
  return text === null ? null : withUnit(text, unit);
}
