/**
 * CSV import rules ported from the API (api/app/connectors/file_import.py and
 * api/app/services/imports.py): column suggestions, athlete matching keys and cell parsing.
 */
import { inputFields, type FormSchema, type InputField } from "@ams/shared";

export class ParseError extends Error {}

const ATHLETE_HEADERS = [
  "athlete_code",
  "code",
  "athlete_id",
  "external_id",
  "player_id",
  "participant_id",
  "athlete",
  "athlete_name",
  "player",
  "player_name",
  "participant",
  "name",
  "full_name",
  "email",
  "athlete_email",
];
const DATE_HEADERS = [
  "local_date",
  "date",
  "session_date",
  "test_date",
  "day",
  "observed_at",
  "datetime",
  "date_time",
  "timestamp",
  "time_stamp",
  "start_time",
];
const SIMILARITY_THRESHOLD = 0.75;

export interface Table {
  columns: string[];
  rows: Record<string, string>[];
}

/** Header row + data rows (blank rows dropped, duplicate or empty headers renamed). */
export function toTable(raw: string[][]): Table {
  const rows = raw.filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) return { columns: [], rows: [] };
  const columns: string[] = [];
  rows[0]!.forEach((name, i) => {
    const base = name.trim() || `column_${i + 1}`;
    let candidate = base;
    let n = 1;
    while (columns.includes(candidate)) {
      n += 1;
      candidate = `${base}_${n}`;
    }
    columns.push(candidate);
  });
  return {
    columns,
    rows: rows.slice(1).map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? "").trim()]))),
  };
}

export function normalizeHeader(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Matched characters of difflib's SequenceMatcher (Ratcliff/Obershelp, no junk). */
function matched(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  let ai = 0;
  let bj = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best) {
          best = cur[j]!;
          ai = i - best;
          bj = j - best;
        }
      }
    }
    prev = cur;
  }
  if (best === 0) return 0;
  return best + matched(a.slice(0, ai), b.slice(0, bj)) + matched(a.slice(ai + best), b.slice(bj + best));
}

/** `difflib.SequenceMatcher(None, a, b).ratio()` */
export function similarityRatio(a: string, b: string): number {
  const total = a.length + b.length;
  return total === 0 ? 1 : (2 * matched(a, b)) / total;
}

function similarity(normCol: string, key: string, normLabel: string): number {
  if (!normCol) return 0;
  if (normCol === key || normCol === normLabel) return 1;
  const stripped = normCol.replace(/_(cm|kg|m|min|s|ms|w|au|pct|percent)$/, "");
  if (stripped && [key, normLabel, key.replace(/_(cm|kg|m|min|s|ms|w|au)$/, "")].includes(stripped)) return 0.95;
  const abbrev = normCol.replace(/s+$/, "");
  if (abbrev.length >= 4 && (key.startsWith(abbrev) || normLabel.startsWith(abbrev))) return 0.8;
  return Math.max(similarityRatio(normCol, key), similarityRatio(normCol, normLabel));
}

function pick(columns: string[], preferred: string[]): string | null {
  const norms = new Map<string, string>();
  for (const c of [...columns].reverse()) norms.set(normalizeHeader(c), c);
  for (const name of preferred) {
    const found = norms.get(name);
    if (found !== undefined) return found;
  }
  return null;
}

export interface Suggestion {
  mapping: Record<string, string>;
  athleteColumn: string | null;
  dateColumn: string | null;
}

export function suggestMapping(table: Table, schema: FormSchema): Suggestion {
  const athleteColumn = pick(table.columns, ATHLETE_HEADERS);
  const dateColumn = pick(
    table.columns.filter((c) => c !== athleteColumn),
    DATE_HEADERS,
  );
  const fields = inputFields(schema).map((f) => [f.key, String(f.label || f.key)] as const);
  const scored: [number, string, string][] = [];
  for (const col of table.columns) {
    if (col === athleteColumn || col === dateColumn) continue;
    const norm = normalizeHeader(col);
    for (const [key, label] of fields) scored.push([similarity(norm, key, normalizeHeader(label)), col, key]);
  }
  scored.sort((x, y) => y[0] - x[0] || table.columns.indexOf(x[1]) - table.columns.indexOf(y[1]));
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const [score, col, key] of scored) {
    if (score < SIMILARITY_THRESHOLD || col in mapping || used.has(key)) continue;
    mapping[col] = key;
    used.add(key);
  }
  const ordered: Record<string, string> = {};
  for (const c of table.columns) if (c in mapping) ordered[c] = mapping[c]!;
  return { mapping: ordered, athleteColumn, dateColumn };
}

// ---------------------------------------------------------------------------- matching

export function normName(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[^ -~]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchKey(value: string, mode: string): string {
  return mode === "name" ? normName(value) : value.trim().toLowerCase();
}

// ---------------------------------------------------------------------------- values

const repr = (s: string) => `'${s}'`;

export function parseNumber(text: string): number {
  let t = text.trim().replace(/\u00a0/g, "").replace(/ /g, "");
  if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) throw new ParseError(`cannot parse ${repr(text)} as a number`);
  const v = Number(t);
  if (!Number.isFinite(v)) throw new ParseError(`cannot parse ${repr(text)} as a number`);
  return v;
}

export function parseDuration(text: string): number {
  const t = text.trim();
  const m = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/.exec(t);
  if (m) {
    const minutes = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
    return Number.isInteger(minutes) ? minutes : Math.round(minutes * 10000) / 10000;
  }
  return parseNumber(t);
}

const TRUE = new Set(["true", "t", "yes", "y", "1"]);
const FALSE = new Set(["false", "f", "no", "n", "0"]);

function option(text: string, options: { value: unknown; label?: string }[]): unknown {
  const t = text.trim();
  for (const o of options) {
    if (String(o.value).toLowerCase() === t.toLowerCase() || String(o.label ?? "").trim().toLowerCase() === t.toLowerCase()) return o.value;
  }
  if (options.length > 0 && options.every((o) => typeof o.value === "number")) {
    try {
      return parseNumber(t);
    } catch {
      /* unknown option */
    }
  }
  return t; // the form engine reports invalid_option
}

export function parseValue(field: InputField, text: string, timeZone: string): unknown {
  const t = text.trim();
  if (t === "") return null;
  const options = ((field as { options?: { value: unknown; label?: string }[] }).options ?? []).filter(
    (o) => typeof o === "object" && o !== null,
  );
  switch (field.type) {
    case "number":
    case "scale":
      return parseNumber(t);
    case "duration":
      return parseDuration(t);
    case "boolean": {
      const low = t.toLowerCase();
      if (TRUE.has(low)) return true;
      if (FALSE.has(low)) return false;
      throw new ParseError(`cannot parse ${repr(text)} as yes/no`);
    }
    case "select":
      return option(t, options);
    case "multiselect":
      return t
        .split(/[;|,]/)
        .filter((x) => x.trim())
        .map((x) => option(x, options));
    case "date":
      return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : t;
    case "time": {
      const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
      return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : t;
    }
    case "datetime": {
      const parsed = parseIsoDateTime(t);
      if (!parsed) return t;
      return parsed.offset !== null ? t : wallTimeToInstant(parsed, timeZone).toISOString().replace(/\.000Z$/, "Z");
    }
    default:
      return t;
  }
}

// ---------------------------------------------------------------------------- dates and time zones

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

const ISO_DT_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function parseIsoDateTime(t: string): (WallTime & { offset: string | null }) | null {
  const m = ISO_DT_RE.exec(t.replace(/z$/, "Z"));
  if (!m) return null;
  const w = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0),
    ms: m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0,
    offset: m[8] ?? null,
  };
  if (!validWallTime(w)) return null;
  return w;
}

function validWallTime(w: WallTime): boolean {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day));
  return (
    d.getUTCFullYear() === w.year &&
    d.getUTCMonth() === w.month - 1 &&
    d.getUTCDate() === w.day &&
    w.hour <= 23 &&
    w.minute <= 59 &&
    w.second <= 59
  );
}

function offsetMs(instant: number, timeZone: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(instant))) if (p.type !== "literal") parts[p.type] = Number(p.value);
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour! % 24, parts.minute!, parts.second!);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant a wall-clock time in `timeZone` denotes. */
export function wallTimeToInstant(w: WallTime, timeZone: string): Date {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, w.ms);
  const first = offsetMs(guess, timeZone);
  let t = guess - first;
  const second = offsetMs(t, timeZone);
  if (second !== first) t = guess - second;
  return new Date(t);
}

function instantOf(p: WallTime & { offset: string | null }, timeZone: string): Date {
  if (p.offset === null) return wallTimeToInstant(p, timeZone);
  const utc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.ms);
  if (p.offset === "Z") return new Date(utc);
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(p.offset)!;
  const sign = m[1] === "-" ? -1 : 1;
  return new Date(utc - sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A subset of Python's `strptime`: %Y %y %m %d %H %I %M %S %f %p %b %B %%. */
function strptime(text: string, fmt: string): WallTime | null {
  const keys: string[] = [];
  let pattern = "";
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i]!;
    if (ch !== "%") {
      pattern += /\s/.test(ch) ? "\\s+" : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      continue;
    }
    const d = fmt[++i];
    const groups: Record<string, string> = {
      Y: "(\\d{4})",
      y: "(\\d{2})",
      m: "(\\d{1,2})",
      d: "(\\d{1,2})",
      H: "(\\d{1,2})",
      I: "(\\d{1,2})",
      M: "(\\d{1,2})",
      S: "(\\d{1,2})",
      f: "(\\d{1,6})",
      p: "(am|pm|AM|PM)",
      b: "([A-Za-z]{3})",
      B: "([A-Za-z]+)",
    };
    if (d === "%") {
      pattern += "%";
      continue;
    }
    if (!d || !groups[d]) return null;
    pattern += groups[d];
    keys.push(d);
  }
  const m = new RegExp(`^${pattern}$`).exec(text);
  if (!m) return null;
  const w: WallTime = { year: 1900, month: 1, day: 1, hour: 0, minute: 0, second: 0, ms: 0 };
  let pm: boolean | null = null;
  keys.forEach((k, i) => {
    const v = m[i + 1]!;
    if (k === "Y") w.year = Number(v);
    else if (k === "y") w.year = Number(v) < 69 ? 2000 + Number(v) : 1900 + Number(v);
    else if (k === "m") w.month = Number(v);
    else if (k === "d") w.day = Number(v);
    else if (k === "H" || k === "I") w.hour = Number(v);
    else if (k === "M") w.minute = Number(v);
    else if (k === "S") w.second = Number(v);
    else if (k === "f") w.ms = Math.round(Number(`0.${v}`) * 1000);
    else if (k === "p") pm = v.toLowerCase() === "pm";
    else if (k === "b") w.month = MONTHS.indexOf(v.toLowerCase()) + 1;
    else if (k === "B") w.month = MONTH_NAMES.indexOf(v.toLowerCase()) + 1;
  });
  if (pm !== null) w.hour = (w.hour % 12) + (pm ? 12 : 0);
  return w.month >= 1 && validWallTime(w) ? w : null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const isoDay = (w: WallTime) => `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;

export interface When {
  /** null for a date-only cell. */
  observedAt: Date | null;
  localDate: string;
}

function dayIn(instant: Date, timeZone: string): string {
  const off = offsetMs(instant.getTime(), timeZone);
  const local = new Date(instant.getTime() + off);
  return `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/** The observation time and local day of a date cell (`parse_when` in the API). */
export function parseWhen(text: string, fmt: string | null | undefined, timeZone: string): When {
  const t = text.trim();
  if (!t) throw new ParseError("missing date");
  if (fmt) {
    const w = strptime(t, fmt);
    if (!w) throw new ParseError(`date ${repr(text)} does not match format ${repr(fmt)}`);
    if (!/%[HIMSfp]/.test(fmt)) return { observedAt: null, localDate: isoDay(w) };
    const instant = wallTimeToInstant(w, timeZone);
    return { observedAt: instant, localDate: dayIn(instant, timeZone) };
  }
  if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(t)) {
    const p = parseIsoDateTime(t.replace(/\//g, "-"));
    if (!p) throw new ParseError(`invalid date ${repr(text)}`);
    return { observedAt: null, localDate: isoDay(p) };
  }
  const p = parseIsoDateTime(t);
  if (!p) throw new ParseError(`cannot parse date ${repr(text)}; use ISO 8601 or pass date_format`);
  const instant = instantOf(p, timeZone);
  return { observedAt: instant, localDate: dayIn(instant, timeZone) };
}

/** Noon on `day` in the time zone (the observation time of date-only rows). */
export function localNoon(day: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return wallTimeToInstant({ year: y!, month: m!, day: d!, hour: 12, minute: 0, second: 0, ms: 0 }, timeZone);
}

export function isoInstant(d: Date): string {
  return d.toISOString().replace(/\.000Z$/, "Z");
}
