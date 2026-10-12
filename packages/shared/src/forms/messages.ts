import { maxLengthOf, scaleStep } from "./fields";
import type { ErrorCode, Field } from "./types";

function fmt(n: number): string {
  return String(n);
}

function withUnit(n: number, unit: unknown): string {
  return typeof unit === "string" && unit !== "" ? `${fmt(n)} ${unit}` : fmt(n);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function rangeText(min: string | null, max: string | null, low = "at least", high = "at most"): string | null {
  if (min !== null && max !== null) return `between ${min} and ${max}`;
  if (min !== null) return `${low} ${min}`;
  if (max !== null) return `${high} ${max}`;
  return null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/**
 * English message for a submission error code. Pass the field to get specifics such as
 * the allowed range; without it a generic message is returned. Unknown codes (e.g. a
 * newer server) get a generic message.
 */
export function errorMessage(code: ErrorCode | string, field?: Field | null): string {
  const f = (field ?? undefined) as (Field & Record<string, unknown>) | undefined;
  switch (code) {
    case "required":
      return f?.type === "multiselect" ? "Select at least one option." : "This field is required.";
    case "invalid_type":
      switch (f?.type) {
        case "number":
        case "scale":
        case "duration":
          return "Enter a number.";
        case "select":
          return "Choose one of the options.";
        case "multiselect":
          return "Choose from the options.";
        case "boolean":
          return "Choose yes or no.";
        case "date":
          return "Enter a date.";
        case "time":
          return "Enter a time.";
        case "datetime":
          return "Enter a date and time.";
        case "text":
        case "textarea":
          return "Enter text.";
        default:
          return "This value has the wrong type.";
      }
    case "invalid_format":
      switch (f?.type) {
        case "date":
          return "Enter a valid date (YYYY-MM-DD).";
        case "time":
          return "Enter a valid 24-hour time (HH:MM).";
        case "datetime":
          return "Enter a valid date and time with a time zone.";
        default:
          return "This value is not in the expected format.";
      }
    case "invalid_option":
      return f?.type === "multiselect"
        ? "Choose only listed options, each once."
        : "Choose one of the listed options.";
    case "invalid_step":
      if (f?.type === "scale" && typeof f.min === "number") {
        return `Choose a value in steps of ${fmt(scaleStep(f))} from ${fmt(f.min)}.`;
      }
      return "This value is not one of the allowed steps.";
    case "out_of_range": {
      if (f?.type === "multiselect") {
        const lo = numberOrNull(f.min_selected);
        const hi = numberOrNull(f.max_selected);
        if (lo !== null && hi !== null) return `Select between ${lo} and ${plural(hi, "option", "options")}.`;
        if (lo !== null) return `Select at least ${plural(lo, "option", "options")}.`;
        if (hi !== null) return `Select at most ${plural(hi, "option", "options")}.`;
        return "Too few or too many options selected.";
      }
      if (f?.type === "date") {
        const r = rangeText(
          typeof f.min === "string" ? f.min : null,
          typeof f.max === "string" ? f.max : null,
          "on or after",
          "on or before",
        );
        return r ? `Enter a date ${r}.` : "This date is out of range.";
      }
      const lo = numberOrNull(f?.min);
      const hi = numberOrNull(f?.max);
      const r = rangeText(lo === null ? null : withUnit(lo, f?.unit), hi === null ? null : withUnit(hi, f?.unit));
      return r ? `Must be ${r}.` : "This value is out of range.";
    }
    case "too_long": {
      if (f && (f.type === "text" || f.type === "textarea")) {
        return `Must be at most ${plural(maxLengthOf(f), "character", "characters")}.`;
      }
      return "This text is too long.";
    }
    case "unknown_field":
      return "This field is not part of the form.";
    default:
      return "This value is not valid.";
  }
}
