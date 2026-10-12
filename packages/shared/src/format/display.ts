import { roundHalfAwayFromZero } from "../expr/evaluate";
import type { Athlete, Flag, MetricDefinition, Organization, Terminology } from "../api/types";

/** Terminology defaults from docs/API.md. */
export const DEFAULT_TERMINOLOGY: Readonly<Terminology> = Object.freeze({
  athlete: "Athlete",
  athletes: "Athletes",
  group: "Group",
  groups: "Groups",
});

type OrgLike =
  | Pick<Organization, "settings">
  | { settings?: { terminology?: Partial<Terminology> | null } | null }
  | null
  | undefined;

/** The org's display labels, falling back per key to the defaults (empty strings count as unset). */
export function terminology(org: OrgLike): Terminology {
  const t = (org?.settings?.terminology ?? {}) as Partial<Terminology>;
  const pick = (k: keyof Terminology): string => {
    const v = t[k];
    return typeof v === "string" && v.trim() !== "" ? v : DEFAULT_TERMINOLOGY[k];
  };
  return { athlete: pick("athlete"), athletes: pick("athletes"), group: pick("group"), groups: pick("groups") };
}

type AthleteLike = Pick<Athlete, "code"> &
  Partial<Pick<Athlete, "display_name" | "masked" | "first_name" | "last_name" | "preferred_name">>;

/**
 * How to show an athlete: the server's `display_name`, or the code when masked. With
 * `withCode`, appends the code when a name is shown: `"Sam Lee (P-014)"`.
 */
export function athleteLabel(athlete: AthleteLike, options: { withCode?: boolean } = {}): string {
  let name = "";
  if (!athlete.masked) {
    if (athlete.display_name && athlete.display_name !== athlete.code) {
      name = athlete.display_name;
    } else {
      const first = athlete.preferred_name || athlete.first_name || "";
      name = [first, athlete.last_name || ""].filter((s) => s !== "").join(" ");
    }
  }
  if (name === "") return athlete.code;
  return options.withCode ? `${name} (${athlete.code})` : name;
}

export type FlagColor = "green" | "amber" | "red" | "none";

/** Semantic colour token for a metric flag. */
export function flagColor(flag: Flag | undefined): FlagColor {
  return flag === "green" || flag === "amber" || flag === "red" ? flag : "none";
}

export interface FormatMetricOptions {
  /** Text for null/missing values. Default `"–"`. */
  empty?: string;
  /** Append the metric's unit (default true). */
  unit?: boolean;
  /** BCP 47 locale for digit grouping and decimal separator; omit for plain `1234.5`. */
  locale?: string;
}

const NO_SPACE_UNITS = new Set(["%", "°", "″", "′"]);

/**
 * Formats a metric value with the metric's `decimals` (half away from zero, like the
 * form engine) and unit: `formatMetricValue(1.256, {decimals: 2, unit: "AU"})` -> `"1.26 AU"`.
 */
export function formatMetricValue(
  value: number | null | undefined,
  metric: Pick<MetricDefinition, "decimals"> & { unit?: string | null },
  options: FormatMetricOptions = {},
): string {
  if (value === null || value === undefined || !isFinite(value)) return options.empty ?? "–";
  const decimals = Number.isInteger(metric.decimals) && metric.decimals >= 0 && metric.decimals <= 20 ? metric.decimals : 0;
  const rounded = roundHalfAwayFromZero(value, Math.min(decimals, 10));
  let text: string;
  if (options.locale && typeof Intl !== "undefined" && typeof Intl.NumberFormat === "function") {
    text = new Intl.NumberFormat(options.locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(rounded);
  } else {
    text = rounded.toFixed(decimals);
  }
  const unit = options.unit === false ? null : metric.unit;
  if (!unit) return text;
  return NO_SPACE_UNITS.has(unit) ? `${text}${unit}` : `${text} ${unit}`;
}
