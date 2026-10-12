/**
 * Calendar-day helpers for ISO dates (`YYYY-MM-DD`). Arithmetic is done in UTC on
 * date-only values, so the device time zone and DST never shift a day. Time zones are
 * applied only where an instant is turned into a day (`dateInTimeZone`), via
 * `Intl.DateTimeFormat`.
 */
import type { ISODate } from "../api/types";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

function pad(n: number, width: number): string {
  let s = String(Math.abs(n));
  while (s.length < width) s = `0${s}`;
  return n < 0 ? `-${s}` : s;
}

/** UTC midnight of a calendar date in ms (`Date.UTC` would map years 0-99 to 19xx). */
function utcMs(year: number, month: number, day: number): number {
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, day);
  return t.getTime();
}

/** Parses `YYYY-MM-DD` (a real calendar date) or throws a `RangeError`. */
export function parseISODate(iso: string): DateParts {
  const m = ISO_DATE_RE.exec(iso);
  if (m) {
    const parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    const t = new Date(utcMs(parts.year, parts.month, parts.day));
    if (t.getUTCFullYear() === parts.year && t.getUTCMonth() === parts.month - 1 && t.getUTCDate() === parts.day) {
      return parts;
    }
  }
  throw new RangeError(`Invalid ISO date: ${JSON.stringify(iso)}`);
}

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string") return false;
  try {
    parseISODate(value);
    return true;
  } catch {
    return false;
  }
}

export function formatISODate(parts: DateParts): ISODate {
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

/** Days since 1970-01-01 for a calendar date. */
function epochDay(iso: string): number {
  const p = parseISODate(iso);
  return Math.round(utcMs(p.year, p.month, p.day) / DAY_MS);
}

function fromEpochDay(n: number): ISODate {
  const t = new Date(n * DAY_MS);
  return formatISODate({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}

/** `isoDate` plus `n` calendar days (negative to go back). */
export function addDays(isoDate: string, n: number): ISODate {
  if (!Number.isInteger(n)) throw new RangeError(`addDays: n must be an integer, got ${n}`);
  return fromEpochDay(epochDay(isoDate) + n);
}

/** Whole days from `a` to `b` (`b - a`). */
export function diffDays(a: string, b: string): number {
  return epochDay(b) - epochDay(a);
}

/** Compares two ISO dates (negative, zero, positive). */
export function compareISODate(a: string, b: string): number {
  return diffDays(b, a);
}

/** Every date from `start` to `end`, both inclusive. Empty when `end < start`. */
export function dateRange(start: string, end: string): ISODate[] {
  const s = epochDay(start);
  const e = epochDay(end);
  const out: ISODate[] = [];
  for (let d = s; d <= e; d++) out.push(fromEpochDay(d));
  return out;
}

/** ISO weekday, 1 = Monday ... 7 = Sunday (as in `FormSchedule.days_of_week`). */
export function isoWeekday(isoDate: string): number {
  // 1970-01-01 was a Thursday (4).
  const d = (((epochDay(isoDate) + 3) % 7) + 7) % 7;
  return d + 1;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    // Throws RangeError for an unknown time zone.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * The calendar date of `instant` in the IANA `timeZone` (e.g. the `local_date` of an
 * `observed_at`). `instant` may be a `Date`, epoch milliseconds or an ISO 8601 string.
 */
export function dateInTimeZone(instant: Date | number | string, timeZone: string): ISODate {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (isNaN(date.getTime())) throw new RangeError(`Invalid instant: ${String(instant)}`);
  const f = formatterFor(timeZone);
  let year = NaN;
  let month = NaN;
  let day = NaN;
  if (typeof f.formatToParts === "function") {
    for (const part of f.formatToParts(date)) {
      if (part.type === "year") year = Number(part.value);
      else if (part.type === "month") month = Number(part.value);
      else if (part.type === "day") day = Number(part.value);
    }
  } else {
    // en-US numeric: "MM/DD/YYYY"
    const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(f.format(date));
    if (m) {
      month = Number(m[1]);
      day = Number(m[2]);
      year = Number(m[3]);
    }
  }
  if (!isFinite(year) || !isFinite(month) || !isFinite(day)) {
    throw new RangeError(`Could not determine the date in ${timeZone}`);
  }
  return formatISODate({ year, month, day });
}

/** Today's date in the IANA `timeZone` (pass `now` for tests). */
export function todayInTimeZone(timeZone: string, now: Date | number = Date.now()): ISODate {
  return dateInTimeZone(now, timeZone);
}

/** Whether the runtime knows the IANA time zone. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}
