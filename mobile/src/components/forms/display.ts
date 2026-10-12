import { roundHalfAwayFromZero, type Field, type FieldOption } from "@ams/shared";
import { formatDateTimeValue, formatDuration, formatShortDate } from "../../lib/format";

/** Plain text from the small Markdown subset used in `help` and descriptions. */
export function stripMarkdown(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

export function formatNumber(n: number, decimals?: number): string {
  if (!isFinite(n)) return "–";
  if (typeof decimals === "number" && decimals >= 0 && decimals <= 10) {
    return roundHalfAwayFromZero(n, decimals).toFixed(decimals);
  }
  return String(roundHalfAwayFromZero(n, 2));
}

function optionLabel(options: FieldOption[] | undefined, value: unknown): string {
  const match = options?.find((o) => o.value === value);
  return match ? match.label : String(value);
}

/** Human-readable value of a field for summaries and history. */
export function displayFieldValue(field: Field | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (Array.isArray(value)) {
    if (value.length === 0) return "–";
    const opts = field && "options" in field ? field.options : undefined;
    return value.map((v) => optionLabel(opts, v)).join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (!field) return typeof value === "number" ? formatNumber(value) : String(value);
  const unit = field.unit ? ` ${field.unit}` : "";
  switch (field.type) {
    case "select":
      return optionLabel(field.options, value);
    case "duration":
      return typeof value === "number" ? formatDuration(value) : String(value);
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatShortDate(value) : String(value);
    case "datetime":
      return typeof value === "string" ? formatDateTimeValue(value) : String(value);
    case "number":
    case "calculated":
      return typeof value === "number" ? `${formatNumber(value, field.decimals)}${unit}` : `${String(value)}${unit}`;
    case "scale":
      return typeof value === "number" ? `${formatNumber(value)}${unit}` : String(value);
    default:
      return `${String(value)}${unit}`;
  }
}
