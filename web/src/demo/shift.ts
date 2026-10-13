/**
 * Moves every calendar date in a fixture by a whole number of days, so data exported on
 * `generated_on` reads as if it were recorded up to today.
 *
 * Strings that are exactly an ISO date (`2026-10-12`) or an ISO date-time
 * (`2026-10-12T06:31:00Z`, `2026-10-12T07:12:00.123456-04:00`) are shifted; their time of
 * day and offset are kept. Object keys that are ISO dates (readiness boards keyed by day)
 * are shifted too. Every other value, including strings that merely contain a date, is
 * left alone.
 */
import { addDays, isISODate } from "@ams/shared";

const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})(T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)$/;

/** The shifted string, or `value` itself when it is not an ISO date or date-time. */
export function shiftDateString(value: string, days: number): string {
  if (days === 0 || value.length < 10 || value.length > 35) return value;
  if (value.length === 10) return isISODate(value) ? addDays(value, days) : value;
  const m = DATE_TIME_RE.exec(value);
  if (!m || !isISODate(m[1])) return value;
  return addDays(m[1]!, days) + m[2]!;
}

/** A deep copy of `value` with every ISO date and date-time moved by `days`. */
export function shiftDates<T>(value: T, days: number): T {
  return shift(value, days) as T;
}

function shift(value: unknown, days: number): unknown {
  if (typeof value === "string") return shiftDateString(value, days);
  if (Array.isArray(value)) return value.map((v) => shift(v, days));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k.length === 10 ? shiftDateString(k, days) : k] = shift(v, days);
    }
    return out;
  }
  return value;
}
