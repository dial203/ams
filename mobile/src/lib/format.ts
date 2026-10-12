import { diffDays, isValidTimeZone, parseISODate } from "@ams/shared";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function weekdayIndex(isoDate: string): number {
  // 1970-01-01 was a Thursday (index 3 with Monday = 0).
  const p = parseISODate(isoDate);
  const t = Date.UTC(p.year, p.month - 1, p.day) / 86400000;
  return (((Math.floor(t) + 3) % 7) + 7) % 7;
}

/** "Monday 12 October" */
export function formatLongDate(isoDate: string): string {
  const p = parseISODate(isoDate);
  return `${WEEKDAYS[weekdayIndex(isoDate)]} ${p.day} ${MONTHS[p.month - 1]}`;
}

/** "12 Oct" */
export function formatShortDate(isoDate: string): string {
  const p = parseISODate(isoDate);
  return `${p.day} ${MONTHS[p.month - 1]!.slice(0, 3)}`;
}

/** "Today", "Yesterday", "Mon 5 Oct" (or "5 Oct 2025" in another year). */
export function formatRelativeDay(isoDate: string, today: string): string {
  const d = diffDays(isoDate, today);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d === -1) return "Tomorrow";
  const p = parseISODate(isoDate);
  if (p.year !== parseISODate(today).year) return `${formatShortDate(isoDate)} ${p.year}`;
  return `${WEEKDAYS[weekdayIndex(isoDate)]!.slice(0, 3)} ${formatShortDate(isoDate)}`;
}

/** The device's IANA time zone, or UTC. */
export function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && isValidTimeZone(tz)) return tz;
  } catch {
    // fall through
  }
  return "UTC";
}

/** First valid zone among the candidates, else the device zone. */
export function pickTimeZone(...candidates: (string | null | undefined)[]): string {
  for (const tz of candidates) if (tz && isValidTimeZone(tz)) return tz;
  return deviceTimeZone();
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function timeParts(instant: Date, timeZone: string): { hour: number; minute: number } {
  let f = timeFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    timeFormatters.set(timeZone, f);
  }
  let hour = NaN;
  let minute = NaN;
  if (typeof f.formatToParts === "function") {
    for (const part of f.formatToParts(instant)) {
      if (part.type === "hour") hour = Number(part.value);
      else if (part.type === "minute") minute = Number(part.value);
    }
  }
  if (!isFinite(hour) || !isFinite(minute)) {
    const m = /(\d{1,2})\D(\d{2})/.exec(f.format(instant));
    hour = m ? Number(m[1]) : instant.getHours();
    minute = m ? Number(m[2]) : instant.getMinutes();
  }
  return { hour: hour % 24, minute };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "07:05" for an instant in a time zone. */
export function formatTimeInZone(instant: string | number | Date, timeZone: string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (isNaN(date.getTime())) return "";
  const { hour, minute } = timeParts(date, timeZone);
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** Minutes since midnight in a time zone. */
export function minutesInZone(now: Date | number, timeZone: string): number {
  const { hour, minute } = timeParts(now instanceof Date ? now : new Date(now), timeZone);
  return hour * 60 + minute;
}

/** Minutes since midnight of "HH:MM", or null. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

export function greetingFor(minutes: number): string {
  if (minutes < 12 * 60) return "Good morning";
  if (minutes < 18 * 60) return "Good afternoon";
  return "Good evening";
}

/** "1 h 30 min", "45 min", "2 h". */
export function formatDuration(totalMinutes: number): string {
  if (!isFinite(totalMinutes)) return "";
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.abs(totalMinutes);
  const h = Math.floor(abs / 60);
  const m = Math.round((abs - h * 60) * 100) / 100;
  if (h === 0) return `${sign}${m} min`;
  if (m === 0) return `${sign}${h} h`;
  return `${sign}${h} h ${m} min`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function formatTimeAgo(instant: string, now: number = Date.now()): string {
  const t = new Date(instant).getTime();
  if (isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Local wall-clock ISO 8601 with offset (for `datetime` fields), e.g. 2026-10-12T07:30:00+02:00. */
export function toLocalIsoWithOffset(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:00` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

/** "YYYY-MM-DD" of a Date's local calendar day. */
export function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** "HH:MM" of a Date's local wall clock. */
export function toLocalClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Local Date at midnight for "YYYY-MM-DD". */
export function dateFromIso(isoDate: string): Date {
  const p = parseISODate(isoDate);
  return new Date(p.year, p.month - 1, p.day);
}

/** Today's local Date with the given "HH:MM". */
export function dateFromClock(clock: string, base: Date = new Date()): Date {
  const minutes = parseClock(clock) ?? 0;
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

/** Display text for an ISO date-time with offset: "12 Oct 2026, 07:30". */
export function formatDateTimeValue(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return `${formatShortDate(toLocalIsoDate(d))} ${d.getFullYear()}, ${toLocalClock(d)}`;
}
