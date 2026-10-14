import { diffDays, type MetricDefinition, type ReadinessBoard, type ReadinessMissing, type ReadinessRow } from "@ams/shared";
import { formatDate } from "@/lib/field-format";

/** Splits a series ref ("form:<slug>.<field>", "wearable:<metric>", "metric:<slug>"). */
export function parseSource(ref: string | null): { kind: "form" | "wearable" | "metric" | null; name: string } {
  if (!ref) return { kind: null, name: "" };
  const colon = ref.indexOf(":");
  const kind = ref.slice(0, colon);
  const rest = ref.slice(colon + 1);
  if (kind === "form") return { kind, name: rest.includes(".") ? rest.slice(0, rest.lastIndexOf(".")) : rest };
  if (kind === "wearable" || kind === "metric") return { kind, name: rest };
  return { kind: null, name: rest };
}

/** Short text for an empty cell. */
export function missingLabel(m: ReadinessMissing, boardDate: string): string {
  switch (m.reason) {
    case "restricted":
      return "restricted";
    case "no_source":
      return parseSource(m.source).kind === "form" ? "no form" : "no source";
    case "not_linked":
      return "no wearable";
    case "no_data":
      return "no data";
    case "stale":
      return m.last_date ? `${diffDays(m.last_date, boardDate)}d ago` : "old";
    case "building":
      return `${m.have ?? 0}/${m.need ?? 0}d`;
    case "no_value":
      return "n/a";
  }
}

/** One or two sentences on why the cell is empty and what fills it. */
export function missingText(m: ReadinessMissing, metric: MetricDefinition, boardDate: string): string {
  const src = parseSource(m.source);
  switch (m.reason) {
    case "restricted":
      return `Your access does not cover the data ${metric.name} is calculated from for this athlete.`;
    case "no_source":
      if (src.kind === "form") return `${metric.name} reads the form “${src.name}”, which does not exist yet. Install it in Forms.`;
      return `${metric.name} reads “${m.source ?? metric.source}”, which does not exist.`;
    case "not_linked":
      return `No wearable linked. Connect one from the athlete’s Wearables tab.`;
    case "no_data":
      if (src.kind === "wearable") return `The linked wearable has sent no ${src.name} data yet. Not every device records it.`;
      if (src.kind === "form") return `No “${src.name}” entries recorded yet.`;
      return "No data recorded yet.";
    case "stale": {
      if (!m.last_date) return "No data in the last 3 days.";
      const days = diffDays(m.last_date, boardDate);
      return `Last data ${formatDate(m.last_date)}, ${days} days before the board date. The board shows values from the last 3 days.`;
    }
    case "building":
      return buildingText(m);
    case "no_value":
      return `Enough data, but the value is undefined${m.last_date ? ` on ${formatDate(m.last_date)}` : ""} (for example, no day-to-day variation in the baseline).`;
  }
}

function buildingText(m: ReadinessMissing): string {
  const have = m.have ?? 0;
  const need = m.need ?? 0;
  const through = m.last_date ? ` up to ${formatDate(m.last_date)}` : "";
  if (m.same_source) {
    const span = m.window ? ` within ${m.window} days` : "";
    return `Baseline building: ${have} of ${need} days from the same device${span}${through}. A device change restarts the count.`;
  }
  if (m.window) return `${have} of the ${need} days of data needed within ${m.window} days${through}.`;
  return `${have} of the ${need} days of data needed so far${through}.`;
}

export type SetupItem =
  | { kind: "no_source"; metric: MetricDefinition; source: string; formSlug: string | null }
  | { kind: "not_linked"; athletes: ReadinessRow["athlete"][]; metrics: MetricDefinition[] }
  | { kind: "no_device_data"; metric: MetricDefinition; source: string; athletes: number }
  | { kind: "building"; metric: MetricDefinition; athletes: number; minLeft: number; maxLeft: number }
  | { kind: "no_schedule"; athletes: number; total: number };

/**
 * Board-wide reasons for empty cells, worst first: metrics whose source does not exist, athletes
 * without a wearable link, linked wearables that send nothing for a metric, baselines still
 * building, and athletes with nothing scheduled (so nothing is ever due).
 */
export function setupItems(board: ReadinessBoard): SetupItem[] {
  const out: SetupItem[] = [];
  const cellsOf = (m: MetricDefinition) =>
    board.rows.map((r) => r.cells[m.slug]?.missing).filter((x): x is ReadinessMissing => !!x);

  for (const m of board.columns) {
    const missing = cellsOf(m).find((x) => x.reason === "no_source");
    if (missing) {
      const src = parseSource(missing.source);
      out.push({ kind: "no_source", metric: m, source: missing.source ?? m.source, formSlug: src.kind === "form" ? src.name : null });
    }
  }

  const unlinked = new Map<string, ReadinessRow["athlete"]>();
  const unlinkedMetrics: MetricDefinition[] = [];
  for (const m of board.columns) {
    let any = false;
    for (const r of board.rows) {
      if (r.cells[m.slug]?.missing?.reason === "not_linked") {
        unlinked.set(r.athlete.id, r.athlete);
        any = true;
      }
    }
    if (any) unlinkedMetrics.push(m);
  }
  if (unlinked.size > 0) out.push({ kind: "not_linked", athletes: [...unlinked.values()], metrics: unlinkedMetrics });

  for (const m of board.columns) {
    const noData = cellsOf(m).filter((x) => x.reason === "no_data" && parseSource(x.source).kind === "wearable");
    if (noData.length > 0) out.push({ kind: "no_device_data", metric: m, source: noData[0]!.source!, athletes: noData.length });
  }

  for (const m of board.columns) {
    const left = cellsOf(m)
      .filter((x) => x.reason === "building")
      .map((x) => Math.max(0, (x.need ?? 0) - (x.have ?? 0)));
    if (left.length > 0) out.push({ kind: "building", metric: m, athletes: left.length, minLeft: Math.min(...left), maxLeft: Math.max(...left) });
  }

  const unscheduled = board.rows.filter((r) => r.scheduled_forms === 0).length;
  if (unscheduled > 0) out.push({ kind: "no_schedule", athletes: unscheduled, total: board.rows.length });
  return out;
}
