import type { Flag, Thresholds } from "@ams/shared";

export interface ChartPoint {
  date: string;
  value: number | null;
  flag?: Flag;
}

export interface Domain {
  min: number;
  max: number;
}

/** Threshold lines worth drawing for a direction (both_bad compares |value|). */
export function thresholdLines(thresholds: Thresholds | undefined): { value: number; level: "amber" | "red" }[] {
  if (!thresholds) return [];
  const out: { value: number; level: "amber" | "red" }[] = [];
  const add = (v: number | null, level: "amber" | "red") => {
    if (v === null || !isFinite(v)) return;
    out.push({ value: v, level });
    if (thresholds.direction === "both_bad" && v !== 0) out.push({ value: -v, level });
  };
  add(thresholds.amber, "amber");
  add(thresholds.red, "red");
  return out;
}

/** Y domain covering the data (and thresholds close to it), padded so lines do not touch the edges. */
export function yDomain(values: number[], extra: number[] = []): Domain {
  if (values.length === 0) return { min: 0, max: 1 };
  let min = Math.min(...values);
  let max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  // Include thresholds near the data (one span, or half the magnitude, whichever is larger),
  // so far-away thresholds do not flatten the line.
  const reach = Math.max(span, 0.5 * Math.max(Math.abs(min), Math.abs(max)));
  for (const t of extra) {
    if (t >= min - reach && t <= max + reach) {
      min = Math.min(min, t);
      max = Math.max(max, t);
    }
  }
  const pad = (max - min || span) * 0.12;
  return { min: min - pad, max: max + pad };
}

/** SVG path for a series, broken at missing values ("missing days stay missing"). */
export function linePath(
  points: ChartPoint[],
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let d = "";
  let penDown = false;
  points.forEach((p, i) => {
    if (p.value === null || !isFinite(p.value)) {
      penDown = false;
      return;
    }
    d += `${penDown ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    penDown = true;
  });
  return d;
}

export function lastValue(points: ChartPoint[]): ChartPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    if (p.value !== null && isFinite(p.value)) return p;
  }
  return null;
}
