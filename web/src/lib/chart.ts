import type { MetricDefinition } from "@ams/shared";

export interface Band {
  y1: number;
  y2: number;
  flag: "amber" | "red";
}

/** Shaded threshold bands for a metric within `[lo, hi]` (docs/API.md threshold rules). */
export function thresholdBands(metric: Pick<MetricDefinition, "thresholds">, lo: number, hi: number): Band[] {
  const t = metric.thresholds;
  if (!t) return [];
  const { amber, red, direction } = t;
  const out: Band[] = [];
  const clamp = (b: Band) => {
    const y1 = Math.max(lo, Math.min(b.y1, b.y2));
    const y2 = Math.min(hi, Math.max(b.y1, b.y2));
    if (y2 > y1) out.push({ ...b, y1, y2 });
  };
  if (direction === "high_bad" || direction === "both_bad") {
    if (amber !== null) clamp({ y1: amber, y2: red ?? hi, flag: "amber" });
    if (red !== null) clamp({ y1: red, y2: hi, flag: "red" });
  }
  if (direction === "low_bad") {
    if (amber !== null) clamp({ y1: red ?? lo, y2: amber, flag: "amber" });
    if (red !== null) clamp({ y1: lo, y2: red, flag: "red" });
  }
  if (direction === "both_bad") {
    if (amber !== null) clamp({ y1: -(red ?? -lo), y2: -amber, flag: "amber" });
    if (red !== null) clamp({ y1: lo, y2: -red, flag: "red" });
  }
  return out;
}

export function niceDomain(values: number[], metric: Pick<MetricDefinition, "thresholds">): [number, number] {
  const t = metric.thresholds;
  const extra: number[] = [];
  if (t) {
    for (const v of [t.amber, t.red]) {
      if (v === null) continue;
      extra.push(v);
      if (t.direction === "both_bad") extra.push(-v);
    }
  }
  const all = [...values, ...extra];
  if (all.length === 0) return [0, 1];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (lo === hi) {
    lo -= Math.abs(lo) * 0.1 || 1;
    hi += Math.abs(hi) * 0.1 || 1;
  }
  const pad = (hi - lo) * 0.12;
  return [lo - pad, hi + pad];
}
