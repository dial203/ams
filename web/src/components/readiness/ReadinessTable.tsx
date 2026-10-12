import { diffDays, formatMetricValue, type MetricDefinition, type ReadinessBoard, type ReadinessCell } from "@ams/shared";
import { Fragment, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ClipboardList } from "lucide-react";
import { FlagIcon } from "@/components/readiness/FlagIcon";
import { FLAG_TEXT, flagCellClass } from "@/lib/flags";
import {
  filterRows,
  sortRows,
  summarize,
  type RowFilter,
  type SortDir,
  type SortKey,
} from "@/components/readiness/readiness-logic";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ReadinessTableProps {
  board: ReadinessBoard;
  sort: SortKey;
  dir: SortDir;
  onSortChange(sort: SortKey, dir: SortDir): void;
  filter: RowFilter;
  onRowClick(athleteId: string): void;
  athleteLabel: string;
}

function sameKey(a: SortKey, b: SortKey): boolean {
  return a.kind === b.kind && (a.kind !== "metric" || (b.kind === "metric" && a.slug === b.slug));
}

export function ReadinessTable({ board, sort, dir, onSortChange, filter, onRowClick, athleteLabel }: ReadinessTableProps) {
  const slugs = board.columns.map((c) => c.slug);
  const rows = sortRows(filterRows(board, filter), slugs, sort, dir);

  const header = (key: SortKey, label: ReactNode, opts: { align?: "left" | "right"; title?: string } = {}) => {
    const active = sameKey(sort, key);
    const nextDir: SortDir = active ? (dir === "asc" ? "desc" : "asc") : key.kind === "athlete" ? "asc" : "desc";
    const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th
        scope="col"
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
        className={cn(
          "sticky top-0 z-10 h-auto border-b bg-background px-0 py-0 align-bottom text-xs font-medium text-muted-foreground",
          opts.align === "right" ? "text-right" : "text-left",
          key.kind === "athlete" && "left-0 z-20",
        )}
      >
        <button
          type="button"
          onClick={() => onSortChange(key, nextDir)}
          title={opts.title}
          className={cn(
            "group inline-flex w-full items-end gap-1 px-3 py-2 outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
            opts.align === "right" && "justify-end text-right",
            active && "text-foreground",
          )}
        >
          <span className="min-w-0">{label}</span>
          <Icon aria-hidden className={cn("mb-0.5 size-3 shrink-0", !active && "opacity-0 group-hover:opacity-60")} />
        </button>
      </th>
    );
  };

  return (
    <div className="relative overflow-auto rounded-lg border bg-card">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {header({ kind: "athlete" }, athleteLabel)}
            {board.columns.map((m) => (
              <Fragment key={m.slug}>
                {header(
                  { kind: "metric", slug: m.slug },
                  <span className="flex flex-col items-end leading-tight">
                    <span className="max-w-[9rem] truncate">{m.name}</span>
                    <span className="text-[11px] font-normal text-muted-foreground/80">{m.unit ?? " "}</span>
                  </span>,
                  { align: "right", title: m.description ?? m.name },
                )}
              </Fragment>
            ))}
            {header({ kind: "due" }, "Due", { align: "right", title: "Forms due today and not yet submitted" })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.athlete.id}
              onClick={() => onRowClick(row.athlete.id)}
              className="group cursor-pointer hover:bg-muted/50"
              data-athlete={row.athlete.id}
            >
              <th
                scope="row"
                className="sticky left-0 z-[1] border-b bg-card px-3 py-1 text-left font-normal group-hover:bg-muted"
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRowClick(row.athlete.id);
                  }}
                  className="flex min-w-[10rem] flex-col items-start rounded-sm text-left leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <span className="font-medium">{row.athlete.display_name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {row.athlete.code}
                    {row.athlete.position ? ` · ${row.athlete.position}` : ""}
                  </span>
                </button>
              </th>
              {board.columns.map((m) => (
                <ReadinessCellView key={m.slug} metric={m} cell={row.cells[m.slug]} boardDate={board.date} />
              ))}
              <td className="border-b px-3 py-1.5 text-right">
                {row.due_forms > 0 ? (
                  <Badge variant="brand" className="tabular" title={`${row.due_forms} form(s) due today`}>
                    <ClipboardList aria-hidden />
                    {row.due_forms}
                    <span className="sr-only"> forms due</span>
                  </Badge>
                ) : (
                  <span className="text-muted-foreground/60" aria-label="No forms due">
                    –
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          {board.rows.length === 0 ? "Nobody to show for this selection." : "No rows match this filter."}
        </div>
      )}
    </div>
  );
}

function ReadinessCellView({ metric, cell, boardDate }: { metric: MetricDefinition; cell: ReadinessCell | undefined; boardDate: string }) {
  if (!cell || cell.value === null) {
    return (
      <td className="border-b px-3 py-1.5 text-right text-muted-foreground/60" data-flag="missing">
        <span title="No data in the last 3 days">–</span>
        <span className="sr-only">No data</span>
      </td>
    );
  }
  const stale = cell.date && cell.date !== boardDate ? diffDays(cell.date, boardDate) : 0;
  const text = formatMetricValue(cell.value, metric, { unit: false });
  const flagText = cell.flag ? `${FLAG_TEXT[cell.flag]} flag. ` : "";
  return (
    <td
      className={cn("border-b px-3 py-1.5 text-right tabular", flagCellClass(cell.flag))}
      data-flag={cell.flag ?? "none"}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-end gap-1.5">
            <FlagIcon flag={cell.flag} />
            <span className={cn("font-medium", cell.flag === "red" && "text-flag-red", !cell.flag && "text-foreground/90")}>
              {text}
            </span>
            {stale > 0 && (
              <span className="text-[10px] text-muted-foreground" aria-label={`from ${stale} days ago`}>
                {stale}d
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {flagText}
          {metric.name}: {formatMetricValue(cell.value, metric)}
          {cell.date ? ` on ${cell.date}` : ""}
        </TooltipContent>
      </Tooltip>
    </td>
  );
}

export function SummaryStrip({
  board,
  filter,
  onFilterChange,
}: {
  board: ReadinessBoard;
  filter: RowFilter;
  onFilterChange(filter: RowFilter): void;
}) {
  const s = summarize(board);
  const tiles: { key: Exclude<RowFilter, null>; label: string; value: number; hint: string; tone: string; icon?: ReactNode }[] = [
    {
      key: "red",
      label: "Red",
      value: s.red,
      hint: "with at least one red flag",
      tone: "text-flag-red",
      icon: <FlagIcon flag="red" />,
    },
    {
      key: "amber",
      label: "Amber",
      value: s.amber,
      hint: "amber, no red",
      tone: "text-flag-amber",
      icon: <FlagIcon flag="amber" />,
    },
    { key: "missing", label: "Missing data", value: s.missing, hint: "no recent value for a metric", tone: "text-foreground" },
    { key: "due", label: "Forms due", value: s.dueForms, hint: `${s.due} with forms outstanding`, tone: "text-foreground" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5" role="group" aria-label="Summary">
      <div className="rounded-lg border bg-card px-3 py-2">
        <div className="text-xs text-muted-foreground">Showing</div>
        <div className="text-lg font-semibold tabular">{s.athletes}</div>
      </div>
      {tiles.map((t) => {
        const active = filter === t.key;
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={active}
            onClick={() => onFilterChange(active ? null : t.key)}
            className={cn(
              "rounded-lg border bg-card px-3 py-2 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40",
              active && "border-foreground/40 bg-muted/60",
            )}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t.icon}
              {t.label}
            </div>
            <div className="flex items-baseline gap-2">
              <span className={cn("text-lg font-semibold tabular", t.value > 0 && t.tone)} data-testid={`summary-${t.key}`}>
                {t.value}
              </span>
              <span className="hidden truncate text-[11px] text-muted-foreground xl:inline" title={t.hint}>
                {t.hint}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
