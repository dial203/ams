import type { MetricDefinition, ReadinessBoard } from "@ams/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RowFilter, SortDir, SortKey } from "@/components/readiness/readiness-logic";
import { summarize } from "@/components/readiness/readiness-logic";
import { ReadinessTable, SummaryStrip } from "@/components/readiness/ReadinessTable";
import { TooltipProvider } from "@/components/ui/tooltip";

function metric(slug: string, name: string, extra: Partial<MetricDefinition> = {}): MetricDefinition {
  return {
    id: slug,
    org_id: "o",
    slug,
    name,
    description: null,
    unit: null,
    source: "form:x.y",
    daily_agg: "last",
    fill_zero: false,
    transform: "none",
    params: {},
    thresholds: { direction: "high_bad", amber: 18, red: 22 },
    decimals: 0,
    athlete_visible: false,
    builtin: true,
    ...extra,
  };
}

const board: ReadinessBoard = {
  date: "2026-10-12",
  group_id: null,
  columns: [metric("hooper", "Wellness", { unit: "AU" }), metric("hrv", "HRV z", { decimals: 2, unit: "z", thresholds: { direction: "low_bad", amber: -0.5, red: -1 } })],
  rows: [
    {
      athlete: { id: "a1", display_name: "Ana Ruiz", code: "A-0001", position: "100m" },
      cells: { hooper: { value: 12, flag: "green", date: "2026-10-12" }, hrv: { value: -1.234, flag: "red", date: "2026-10-11" } },
      due_forms: 0,
    },
    {
      athlete: { id: "a2", display_name: "Ben Cole", code: "A-0002", position: null },
      cells: { hooper: { value: 19, flag: "amber", date: "2026-10-12" }, hrv: { value: null, flag: null, date: null } },
      due_forms: 2,
    },
    {
      athlete: { id: "a3", display_name: "Cy Dunn", code: "A-0003", position: null },
      cells: { hooper: { value: 8, flag: "green", date: "2026-10-12" }, hrv: { value: 0.3, flag: "green", date: "2026-10-12" } },
      due_forms: 1,
    },
  ],
};

function Harness({ onRowClick = () => {} }: { onRowClick?: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: { kind: "priority" }, dir: "desc" });
  const [filter, setFilter] = useState<RowFilter>(null);
  return (
    <TooltipProvider>
      <SummaryStrip board={board} filter={filter} onFilterChange={setFilter} />
      <ReadinessTable
        board={board}
        sort={sort.key}
        dir={sort.dir}
        onSortChange={(key, dir) => setSort({ key, dir })}
        filter={filter}
        athleteLabel="Athlete"
        onRowClick={onRowClick}
      />
    </TooltipProvider>
  );
}

const rowNames = () =>
  screen.getAllByRole("rowheader").map((th) => within(th).getByRole("button").textContent?.split("A-")[0]);

describe("readiness board", () => {
  it("renders flags with colour, shape and text, formatted by the metric's decimals", () => {
    render(<Harness />);
    const ana = screen.getByText("Ana Ruiz").closest("tr")!;
    const cells = within(ana).getAllByRole("cell");
    // HRV: red, 2 decimals, value from yesterday
    const hrv = cells[1]!;
    expect(hrv).toHaveAttribute("data-flag", "red");
    expect(hrv).toHaveTextContent("-1.23");
    expect(within(hrv).getByText("Red flag")).toHaveClass("sr-only");
    expect(hrv.querySelector("svg")).not.toBeNull();
    expect(within(hrv).getByText("1d")).toBeInTheDocument();
    // amber with a triangle icon and text
    const ben = screen.getByText("Ben Cole").closest("tr")!;
    const benCells = within(ben).getAllByRole("cell");
    expect(benCells[0]).toHaveAttribute("data-flag", "amber");
    expect(within(benCells[0]!).getByText("Amber flag")).toBeInTheDocument();
    expect(benCells[1]).toHaveAttribute("data-flag", "missing");
    expect(within(benCells[1]!).getByText("No data")).toBeInTheDocument();
    expect(within(ben).getByText("forms due", { exact: false })).toBeInTheDocument();
  });

  it("summarises red, amber, missing and due counts", () => {
    expect(summarize(board)).toEqual({ athletes: 3, red: 1, amber: 1, missing: 1, due: 2, dueForms: 3 });
    render(<Harness />);
    expect(screen.getByTestId("summary-red")).toHaveTextContent("1");
    expect(screen.getByTestId("summary-amber")).toHaveTextContent("1");
    expect(screen.getByTestId("summary-missing")).toHaveTextContent("1");
    expect(screen.getByTestId("summary-due")).toHaveTextContent("3");
  });

  it("sorts by priority, then by column, and filters from the summary", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<Harness onRowClick={onRowClick} />);
    expect(rowNames()).toEqual(["Ana Ruiz", "Ben Cole", "Cy Dunn"]);
    await user.click(screen.getByRole("button", { name: /Wellness/ }));
    expect(rowNames()).toEqual(["Ben Cole", "Ana Ruiz", "Cy Dunn"]);
    expect(screen.getByRole("columnheader", { name: /Wellness/ })).toHaveAttribute("aria-sort", "descending");
    await user.click(screen.getByRole("button", { name: /Wellness/ }));
    expect(rowNames()).toEqual(["Cy Dunn", "Ana Ruiz", "Ben Cole"]);
    // missing values sort last in both directions
    await user.click(screen.getByRole("button", { name: /HRV z/ }));
    expect(rowNames().at(-1)).toBe("Ben Cole");
    await user.click(screen.getByRole("button", { name: /Red/ }));
    expect(rowNames()).toEqual(["Ana Ruiz"]);
    await user.click(screen.getByRole("button", { name: /^Ana Ruiz/ }));
    expect(onRowClick).toHaveBeenCalledWith("a1");
  });
});
