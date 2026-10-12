import type { ReadinessBoard, ReadinessRow } from "@ams/shared";

export type SortKey = { kind: "priority" } | { kind: "athlete" } | { kind: "due" } | { kind: "metric"; slug: string };
export type SortDir = "asc" | "desc";
export type RowFilter = "red" | "amber" | "missing" | "due" | null;

const SEVERITY = { red: 3, amber: 2, green: 0 } as const;

/** 3 = any red, 2 = any amber, 1 = missing data, 0 = all fine. */
export function rowSeverity(row: ReadinessRow, slugs: readonly string[]): number {
  let worst = 0;
  for (const s of slugs) {
    const cell = row.cells[s];
    if (!cell || cell.value === null) {
      worst = Math.max(worst, 1);
      continue;
    }
    if (cell.flag) worst = Math.max(worst, SEVERITY[cell.flag]);
  }
  return worst;
}

export function rowHasFlag(row: ReadinessRow, slugs: readonly string[], flag: "red" | "amber"): boolean {
  return slugs.some((s) => row.cells[s]?.flag === flag);
}

export function rowHasMissing(row: ReadinessRow, slugs: readonly string[]): boolean {
  return slugs.some((s) => {
    const c = row.cells[s];
    return !c || c.value === null;
  });
}

export interface ReadinessSummary {
  athletes: number;
  red: number;
  amber: number;
  missing: number;
  due: number;
  dueForms: number;
}

/** Athletes with any red; any amber (and no red); any missing value; with forms due. */
export function summarize(board: ReadinessBoard): ReadinessSummary {
  const slugs = board.columns.map((c) => c.slug);
  let red = 0;
  let amber = 0;
  let missing = 0;
  let due = 0;
  let dueForms = 0;
  for (const row of board.rows) {
    if (rowHasFlag(row, slugs, "red")) red++;
    else if (rowHasFlag(row, slugs, "amber")) amber++;
    if (rowHasMissing(row, slugs)) missing++;
    if (row.due_forms > 0) due++;
    dueForms += row.due_forms;
  }
  return { athletes: board.rows.length, red, amber, missing, due, dueForms };
}

export function filterRows(board: ReadinessBoard, filter: RowFilter): ReadinessRow[] {
  const slugs = board.columns.map((c) => c.slug);
  switch (filter) {
    case "red":
      return board.rows.filter((r) => rowHasFlag(r, slugs, "red"));
    case "amber":
      return board.rows.filter((r) => !rowHasFlag(r, slugs, "red") && rowHasFlag(r, slugs, "amber"));
    case "missing":
      return board.rows.filter((r) => rowHasMissing(r, slugs));
    case "due":
      return board.rows.filter((r) => r.due_forms > 0);
    default:
      return board.rows;
  }
}

const byName = (a: ReadinessRow, b: ReadinessRow) =>
  a.athlete.display_name.localeCompare(b.athlete.display_name) || a.athlete.code.localeCompare(b.athlete.code);

/** Sorts rows; missing metric values always sort last. */
export function sortRows(rows: readonly ReadinessRow[], slugs: readonly string[], key: SortKey, dir: SortDir): ReadinessRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const out = rows.slice();
  switch (key.kind) {
    case "athlete":
      return out.sort((a, b) => sign * byName(a, b));
    case "due":
      return out.sort((a, b) => sign * (a.due_forms - b.due_forms) || byName(a, b));
    case "priority":
      return out.sort((a, b) => rowSeverity(b, slugs) - rowSeverity(a, slugs) || byName(a, b));
    case "metric":
      return out.sort((a, b) => {
        const va = a.cells[key.slug]?.value ?? null;
        const vb = b.cells[key.slug]?.value ?? null;
        if (va === null && vb === null) return byName(a, b);
        if (va === null) return 1;
        if (vb === null) return -1;
        return sign * (va - vb) || byName(a, b);
      });
  }
}
