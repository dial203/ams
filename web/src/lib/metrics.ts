import type { MetricCreate, MetricDefinition, Transform } from "@ams/shared";

export interface ParamSpec {
  key: string;
  label: string;
  kind: "int" | "number" | "bool" | "select";
  /** Default as documented in docs/API.md (shown as placeholder). */
  default: string;
  options?: string[];
  hint?: string;
}

/** Transform parameters and defaults (docs/API.md "Metric transforms"). */
export const TRANSFORM_PARAMS: Record<Transform, ParamSpec[]> = {
  none: [],
  rolling_mean: [
    { key: "window", label: "Window (days)", kind: "int", default: "7" },
    { key: "min_periods", label: "Min. observations", kind: "int", default: "ceil(window × 0.7)", hint: "Fewer values in the window give no value" },
    { key: "ln", label: "Average ln(x)", kind: "bool", default: "false", hint: "For right-skewed data such as RMSSD" },
  ],
  rolling_sum: [
    { key: "window", label: "Window (days)", kind: "int", default: "7" },
    { key: "min_periods", label: "Min. observations", kind: "int", default: "window" },
  ],
  ewma: [{ key: "span", label: "Span (days)", kind: "int", default: "7", hint: "λ = 2 / (span + 1) (Williams et al. 2017)" }],
  acwr: [
    { key: "acute", label: "Acute (days)", kind: "int", default: "7" },
    { key: "chronic", label: "Chronic (days)", kind: "int", default: "28" },
    { key: "method", label: "Method", kind: "select", default: "ewma", options: ["ewma", "rolling"] },
    { key: "coupled", label: "Coupled", kind: "bool", default: "false", hint: "Off: the chronic window excludes the acute window (Lolli et al. 2019)" },
  ],
  zscore: [
    { key: "baseline", label: "Baseline (days)", kind: "int", default: "28", hint: "Days before today; same source/device only" },
    { key: "min_periods", label: "Min. baseline days", kind: "int", default: "14" },
    { key: "smooth", label: "Smoothing (days)", kind: "int", default: "1", hint: "Rolling mean of today's value before scoring" },
    { key: "ln", label: "Use ln(x)", kind: "bool", default: "false" },
  ],
  pct_change: [
    { key: "baseline", label: "Baseline (days)", kind: "int", default: "28" },
    { key: "min_periods", label: "Min. baseline days", kind: "int", default: "14" },
  ],
  monotony: [{ key: "window", label: "Window (days)", kind: "int", default: "7", hint: "Mean / SD of daily load (Foster 1998); no value when SD = 0" }],
  strain: [{ key: "window", label: "Window (days)", kind: "int", default: "7", hint: "Weekly load × monotony" }],
};

export const TRANSFORM_HELP: Record<Transform, string> = {
  none: "The daily value after aggregation.",
  rolling_mean: "Mean over the trailing window including today.",
  rolling_sum: "Sum over the trailing window including today.",
  ewma: "Exponentially weighted moving average.",
  acwr: "Acute load divided by chronic load.",
  zscore: "(smoothed value − baseline mean) / baseline SD, against the days before today from the same source.",
  pct_change: "100 × (value − baseline mean) / baseline mean.",
  monotony: "Training monotony.",
  strain: "Training strain.",
};

/** Keeps only the params that the transform accepts. */
export function paramsFor(transform: Transform, params: Record<string, number | string | boolean>): Record<string, number | string | boolean> {
  const keys = new Set(TRANSFORM_PARAMS[transform].map((p) => p.key));
  const out: Record<string, number | string | boolean> = {};
  for (const [k, v] of Object.entries(params)) if (keys.has(k)) out[k] = v;
  return out;
}

/** Whether to show the description as a caveat (ACWR or descriptions that ask for care). */
export function hasCaveat(m: Pick<MetricDefinition, "transform" | "description">): boolean {
  return m.transform === "acwr" || /interpret with care|caveat|critique|coupling/i.test(m.description ?? "");
}

export function emptyMetric(): MetricCreate {
  return {
    slug: "",
    name: "",
    description: null,
    unit: null,
    source: "",
    daily_agg: "last",
    fill_zero: false,
    transform: "none",
    params: {},
    thresholds: null,
    decimals: 1,
    athlete_visible: false,
  };
}

export function toEditable(m: MetricDefinition): MetricCreate {
  return {
    slug: m.slug,
    name: m.name,
    description: m.description,
    unit: m.unit,
    source: m.source,
    daily_agg: m.daily_agg,
    fill_zero: m.fill_zero,
    transform: m.transform,
    params: { ...m.params },
    thresholds: m.thresholds ? { ...m.thresholds } : null,
    decimals: m.decimals,
    athlete_visible: m.athlete_visible,
  };
}

export const METRIC_SLUG = /^[a-z][a-z0-9_]{0,62}$/;
