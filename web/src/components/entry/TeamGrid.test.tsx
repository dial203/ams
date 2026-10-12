import type { BulkSubmissionCreate, BulkSubmissionResult, FormSchema, Submission } from "@ams/shared";
import { compileForm } from "@ams/shared";
import { createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import formCases from "../../../../spec/form-cases.json";
import { isGridPaste, parseCellText, parseClipboard, prepareBulkSave } from "@/components/entry/grid-logic";
import { TeamGrid, type GridAthlete } from "@/components/entry/TeamGrid";
import { TooltipProvider } from "@/components/ui/tooltip";

const schemas = formCases.schemas as unknown as Record<string, FormSchema>;
const wellness = schemas.wellness!;
const session = schemas.session!;

const athletes: GridAthlete[] = [
  { id: "a1", label: "Ana" },
  { id: "a2", label: "Ben" },
  { id: "a3", label: "Cy" },
];

const form = { id: "form-1", name: "Wellness", allow_multiple_per_day: false };

function submission(athleteId: string, values: Record<string, unknown>): Submission {
  return {
    id: `s-${athleteId}`,
    org_id: "o",
    form_id: form.id,
    form_version_id: "v1",
    form_version: 1,
    athlete_id: athleteId,
    athlete_display_name: athleteId,
    submitted_by: null,
    observed_at: "2026-10-12T08:00:00Z",
    local_date: "2026-10-12",
    values,
    computed: {},
    source: "web",
    import_batch_id: null,
    created_at: "2026-10-12T08:00:00Z",
    updated_at: "2026-10-12T08:00:00Z",
  };
}

function setup(schema: FormSchema = wellness, onSave = vi.fn<(p: BulkSubmissionCreate) => Promise<BulkSubmissionResult>>()) {
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <TeamGrid form={form} schema={schema} athletes={athletes} date="2026-10-12" onSave={onSave} />
    </TooltipProvider>,
  );
  const cell = (label: string, athlete: string) => screen.getByRole("textbox", { name: `${label}, ${athlete}` });
  const select = (label: string, athlete: string) => screen.getByRole("combobox", { name: `${label}, ${athlete}` });
  return { user, onSave, cell, select };
}

describe("TeamGrid keyboard entry", () => {
  it("moves with Enter, arrows and Tab", async () => {
    const { user, cell } = setup();
    await user.click(cell("Sleep quality", "Ana"));
    await user.keyboard("3{Enter}");
    expect(cell("Sleep quality", "Ben")).toHaveFocus();
    await user.keyboard("5{ArrowDown}");
    expect(cell("Sleep quality", "Cy")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(cell("Sleep quality", "Ben")).toHaveFocus();
    // focusing selects the text, so ArrowRight moves to the next column
    await user.keyboard("{ArrowRight}");
    expect(cell("Fatigue", "Ben")).toHaveFocus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(cell("Fatigue", "Ana")).toHaveFocus();
    await user.tab();
    expect(cell("Stress", "Ana")).toHaveFocus();
    expect(cell("Sleep quality", "Ana")).toHaveValue("3");
    expect(cell("Sleep quality", "Ben")).toHaveValue("5");
  });

  it("computes calculated columns live and builds the bulk payload from valid rows", async () => {
    const onSave = vi.fn<(p: BulkSubmissionCreate) => Promise<BulkSubmissionResult>>().mockResolvedValue({
      created: [submission("a1", {})],
      errors: [{ athlete_id: "a3", field_errors: { local_date: "duplicate" } }],
    });
    const { user, cell, select } = setup(wellness, onSave);

    await user.click(cell("Sleep quality", "Ana"));
    await user.keyboard("3{Tab}4{Tab}2{Tab}5{Tab}7,5");
    await user.selectOptions(select("Any pain or injury?", "Ana"), "No");
    const anaRow = screen.getByRole("rowheader", { name: /Ana/ }).closest("tr")!;
    expect(within(anaRow).getByText("14")).toBeInTheDocument();
    // hidden by visible_if: has_pain == true
    expect(within(anaRow).getByRole("textbox", { name: "Pain (0-10), Ana" })).toBeDisabled();

    // Ben: incomplete -> not sent
    await user.click(cell("Sleep quality", "Ben"));
    await user.keyboard("2");
    // Cy: complete, with pain
    await user.click(cell("Sleep quality", "Cy"));
    await user.keyboard("1{Tab}1{Tab}1{Tab}1");
    await user.selectOptions(select("Any pain or injury?", "Cy"), "Yes");
    await user.click(cell("Pain (0-10)", "Cy"));
    await user.keyboard("4");

    await user.click(screen.getByRole("button", { name: /Save all/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toEqual({
      form_id: "form-1",
      local_date: "2026-10-12",
      entries: [
        { athlete_id: "a1", values: { sleep_quality: 3, fatigue: 4, stress: 2, soreness: 5, sleep_hours: 7.5, has_pain: false } },
        // pain_location is required when visible but this row leaves it empty -> invalid, so only valid rows are sent
      ],
    });
    // Ben's row shows its errors after the save attempt
    const benRow = screen.getByRole("rowheader", { name: /Ben/ }).closest("tr")!;
    expect(within(benRow).getByText(/errors/)).toBeInTheDocument();
    expect(await within(anaRow).findByText("Saved")).toBeInTheDocument();
    expect(within(anaRow).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows row-level server errors from the bulk result", async () => {
    const onSave = vi.fn<(p: BulkSubmissionCreate) => Promise<BulkSubmissionResult>>().mockResolvedValue({
      created: [],
      errors: [{ athlete_id: "a1", field_errors: { local_date: "duplicate" } }],
    });
    const { user, cell, select } = setup(wellness, onSave);
    await user.click(cell("Sleep quality", "Ana"));
    await user.keyboard("3{Tab}4{Tab}2{Tab}5");
    await user.selectOptions(select("Any pain or injury?", "Ana"), "No");
    await user.keyboard("{Control>}s{/Control}");
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const anaRow = screen.getByRole("rowheader", { name: /Ana/ }).closest("tr")!;
    expect(await within(anaRow).findByText("Already submitted")).toBeInTheDocument();
  });

  it("fills a block of cells from a spreadsheet paste", async () => {
    const { cell } = setup();
    const target = cell("Sleep quality", "Ben");
    target.focus();
    const paste = createEvent.paste(target, { clipboardData: { getData: () => "3\t4\t2\t5\n2\t2\t2\t2\n" } });
    fireEvent(target, paste);
    expect(cell("Sleep quality", "Ben")).toHaveValue("3");
    expect(cell("Soreness".replace("Soreness", "Muscle soreness"), "Ben")).toHaveValue("5");
    expect(cell("Fatigue", "Cy")).toHaveValue("2");
    expect(cell("Sleep quality", "Ana")).toHaveValue("");
  });

  it("uses dropdowns for select fields with type-ahead labels and hides dependent cells", async () => {
    const { user, select, cell } = setup(session);
    await user.selectOptions(select("Type", "Ana"), "Rest");
    expect(select("Session RPE (CR-10)", "Ana")).toBeDisabled();
    await user.selectOptions(select("Type", "Ben"), "Field");
    await user.selectOptions(select("Session RPE (CR-10)", "Ben"), "5 · Hard");
    await user.click(cell("Duration", "Ben"));
    await user.keyboard("1:30");
    const benRow = screen.getByRole("rowheader", { name: /Ben/ }).closest("tr")!;
    expect(within(benRow).getByText("450 AU")).toBeInTheDocument();
    expect(within(benRow).getByText("moderate")).toBeInTheDocument();
  });
});

describe("grid-logic", () => {
  it("parses typed and pasted text per field type", () => {
    const fields = Object.fromEntries(session.sections[0]!.fields.map((f) => [f.key, f]));
    expect(parseCellText(fields.rpe as never, "Hard")).toBe(5);
    expect(parseCellText(fields.rpe as never, "7")).toBe(7);
    expect(parseCellText(fields.session_type as never, "gym")).toBe("gym");
    expect(parseCellText(fields.duration as never, "1:15")).toBe(75);
    expect(parseCellText(fields.duration as never, "1h30")).toBe(90);
    expect(parseCellText(fields.duration as never, "45")).toBe(45);
    expect(parseCellText(wellness.sections[1]!.fields[0] as never, "y")).toBe(true);
    expect(parseCellText(wellness.sections[0]!.fields[0] as never, "abc")).toBe("abc");
    expect(parseCellText(wellness.sections[0]!.fields[0] as never, " ")).toBeUndefined();
  });

  it("splits clipboard blocks", () => {
    expect(isGridPaste("12")).toBe(false);
    expect(isGridPaste("12\n13\n")).toBe(true);
    expect(parseClipboard("1\t2\r\n3\t4\r\n")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("prepareBulkSave sends only filled, valid, unsaved rows", () => {
    const compiled = compileForm(wellness);
    const rows = [
      { athleteId: "a1", values: { sleep_quality: 1, fatigue: 1, stress: 1, soreness: 1, has_pain: false, pain_score: 9 } },
      { athleteId: "a2", values: {} },
      { athleteId: "a3", values: { sleep_quality: 1 } },
      { athleteId: "a4", values: { sleep_quality: 1, fatigue: 1, stress: 1, soreness: 1, has_pain: false } },
    ];
    const r = prepareBulkSave(compiled, "f", "2026-10-12", rows, new Set(["a4"]));
    expect(r.invalid).toEqual(["a3"]);
    expect(r.payload).toEqual({
      form_id: "f",
      local_date: "2026-10-12",
      entries: [{ athlete_id: "a1", values: { sleep_quality: 1, fatigue: 1, stress: 1, soreness: 1, has_pain: false } }],
    });
  });
});
