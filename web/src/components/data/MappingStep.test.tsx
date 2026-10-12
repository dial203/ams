import type { FormSchema, ImportCommit, ImportPreview } from "@ams/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import formCases from "../../../../spec/form-cases.json";
import { buildCommit, guessMatch, initialMapping, mappingIssues, type MappingState } from "@/components/data/import-logic";
import { MappingStep } from "@/components/data/MappingStep";

const session = (formCases.schemas as unknown as Record<string, FormSchema>).session!;

const preview: ImportPreview = {
  upload_id: "up-1",
  columns: ["Player", "Date", "Type", "RPE", "Minutes", "Load", "Notes"],
  row_count: 42,
  sample_rows: [
    { Player: "A-0001", Date: "12/10/2026", Type: "field", RPE: "6", Minutes: "75", Load: "450", Notes: "" },
    { Player: "A-0002", Date: "12/10/2026", Type: "gym", RPE: "4", Minutes: "60", Load: "240", Notes: "late" },
  ],
  // srpe is calculated and must not be offered; Player is the athlete column
  suggested_mapping: { Type: "session_type", RPE: "rpe", Minutes: "duration", Load: "srpe", Player: "rpe" },
  suggested_athlete_column: "Player",
  suggested_date_column: "Date",
};

function Harness({ onSubmit }: { onSubmit(c: Omit<ImportCommit, "upload_id" | "dry_run">): void }) {
  const [state, setState] = useState<MappingState>(() => initialMapping(preview, session, { today: "2026-10-12", timezone: "Europe/London" }));
  return <MappingStep preview={preview} schema={session} state={state} onStateChange={setState} onSubmit={onSubmit} onBack={() => {}} />;
}

describe("import wizard mapping step", () => {
  it("starts from the server's suggestions, dropping non-input targets", () => {
    const s = initialMapping(preview, session, { today: "2026-10-12", timezone: "UTC" });
    expect(s.mapping).toEqual({ Player: "", Date: "", Type: "session_type", RPE: "rpe", Minutes: "duration", Load: "", Notes: "" });
    expect(s.athleteColumn).toBe("Player");
    expect(s.athleteMatch).toBe("code");
    expect(s.dateColumn).toBe("Date");
  });

  it("edits the mapping and submits the commit body", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    // athlete and date columns are not mappable
    const playerRow = screen.getByText("Player", { selector: "td" }).closest("tr")!;
    expect(within(playerRow).getByText(/Used as athlete column/)).toBeInTheDocument();
    // calculated fields are not offered as targets
    const loadSelect = screen.getByRole("combobox", { name: "Field for column Load" });
    expect(within(loadSelect).queryByRole("option", { name: /Session load/ })).toBeNull();
    expect(loadSelect).toHaveValue("");

    await user.selectOptions(screen.getByRole("combobox", { name: "Field for column Notes" }), "hard_reason");
    await user.type(screen.getByLabelText("Date format"), "%d/%m/%Y");
    await user.click(screen.getByRole("button", { name: "Check import (dry run)" }));

    expect(onSubmit).toHaveBeenCalledWith({
      mapping: { Type: "session_type", RPE: "rpe", Minutes: "duration", Notes: "hard_reason" },
      athlete_column: "Player",
      athlete_match: "code",
      date_column: "Date",
      date_format: "%d/%m/%Y",
      default_date: "2026-10-12",
      timezone: "Europe/London",
    });
  });

  it("blocks duplicate targets and a missing athlete column", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Field for column Load" }), "rpe");
    expect(screen.getAllByText("Also mapped from another column")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Check import (dry run)" })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Field for column Load" }), "");
    expect(screen.getByRole("button", { name: "Check import (dry run)" })).toBeEnabled();

    await user.selectOptions(screen.getByLabelText("Athlete column"), "");
    expect(screen.getByText("Choose the column that identifies the person")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check import (dry run)" })).toBeDisabled();
    // choosing an email column switches the match strategy
    await user.selectOptions(screen.getByLabelText("Athlete column"), "Player");
    expect(screen.getByLabelText("Match by")).toHaveValue("code");
  });

  it("uses the default date when there is no date column", () => {
    const s: MappingState = { ...initialMapping(preview, session, { today: "2026-10-12", timezone: "UTC" }), dateColumn: "" };
    expect(buildCommit(s)).toMatchObject({ date_column: null, default_date: "2026-10-12" });
    expect(mappingIssues({ ...s, defaultDate: "" }).date).toBeDefined();
    expect(guessMatch("Email", { sample_rows: [{ Email: "a@b.org" }] })).toBe("email");
    expect(guessMatch("Athlete", { sample_rows: [{ Athlete: "Sam Lee" }] })).toBe("name");
  });
});
