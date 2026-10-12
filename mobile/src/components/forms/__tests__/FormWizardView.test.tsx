import { fireEvent, render, screen, within } from "@testing-library/react-native";
import type { FormSchema, SubmissionValidation } from "@ams/shared";
import { SPEC } from "../../../test/fixtures";
import { FormWizardView } from "../FormWizardView";
import { useFormWizard } from "../useFormWizard";

function Harness({ schema, onSubmit }: { schema: FormSchema; onSubmit: (v: SubmissionValidation) => void }) {
  const wizard = useFormWizard(schema);
  return <FormWizardView wizard={wizard} intro="Takes 30 seconds." onSubmit={onSubmit} />;
}

async function renderForm(schema: FormSchema) {
  const onSubmit = jest.fn();
  await render(<Harness schema={schema} onSubmit={onSubmit} />);
  return onSubmit;
}

const field = (key: string) => within(screen.getByTestId(`field-${key}`));
const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const next = () => press(screen.getByTestId("wizard-primary"));

describe("FormWizardView: wellness (scales, calculated, boolean, multiselect)", () => {
  it("walks the wizard, shows live calculations and required errors, and submits engine values", async () => {
    const onSubmit = await renderForm(SPEC.schemas.wellness);

    expect(screen.getByText("Takes 30 seconds.")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "This morning" })).toBeOnTheScreen();
    expect(screen.getByText("Step 1 of 2")).toBeOnTheScreen();
    expect(screen.getByTestId("computed-hooper_total")).toHaveTextContent("–");
    // A 1-7 scale is a row of seven buttons.
    expect(field("fatigue").getAllByRole("radio")).toHaveLength(7);

    await next();
    expect(screen.getAllByText("⚠ This field is required.")).toHaveLength(4);
    expect(screen.getByText("Step 1 of 2")).toBeOnTheScreen();

    for (const key of ["sleep_quality", "fatigue", "stress", "soreness"]) {
      await press(field(key).getByRole("radio", { name: "3" }));
    }
    expect(field("fatigue").getByRole("radio", { name: "3" })).toBeSelected();
    expect(screen.queryByText("⚠ This field is required.")).not.toBeOnTheScreen();
    expect(screen.getByTestId("computed-hooper_total")).toHaveTextContent("12");

    await fireEvent.changeText(screen.getByTestId("input-sleep_hours"), "7,5");
    await next();

    expect(screen.getByRole("header", { name: "Pain" })).toBeOnTheScreen();
    expect(screen.getByText("Step 2 of 2")).toBeOnTheScreen();
    expect(screen.queryByTestId("field-pain_location")).not.toBeOnTheScreen();

    await press(field("has_pain").getByRole("radio", { name: "Yes" }));
    expect(screen.getByTestId("field-pain_location")).toBeOnTheScreen();
    // 0-10 has 11 points: still buttons.
    expect(field("pain_score").getAllByRole("radio")).toHaveLength(11);

    // max_selected: 2
    await press(field("pain_location").getByRole("checkbox", { name: "Ankle" }));
    await press(field("pain_location").getByRole("checkbox", { name: "Knee" }));
    await press(field("pain_location").getByRole("checkbox", { name: "Hip" }));
    expect(field("pain_location").getByRole("checkbox", { name: "Hip" })).not.toBeChecked();
    expect(screen.getByText("You can choose up to 2. Unselect one first.")).toBeOnTheScreen();

    await next();
    expect(field("pain_score").getByText("⚠ This field is required.")).toBeOnTheScreen();
    expect(onSubmit).not.toHaveBeenCalled();

    await press(field("pain_score").getByRole("radio", { name: "4" }));
    await next();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const validation = onSubmit.mock.calls[0]![0] as SubmissionValidation;
    expect(validation.ok).toBe(true);
    expect(validation.values).toEqual({
      sleep_quality: 3,
      fatigue: 3,
      stress: 3,
      soreness: 3,
      sleep_hours: 7.5,
      has_pain: true,
      pain_location: ["ankle", "knee"],
      pain_score: 4,
    });
    expect(validation.computed).toEqual({ hooper_total: 12 });
  });

  it("keeps answers when going back", async () => {
    await renderForm(SPEC.schemas.wellness);
    for (const key of ["sleep_quality", "fatigue", "stress", "soreness"]) {
      await press(field(key).getByRole("radio", { name: "2" }));
    }
    await next();
    await press(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("header", { name: "This morning" })).toBeOnTheScreen();
    expect(field("stress").getByRole("radio", { name: "2" })).toBeSelected();
    expect(screen.getByTestId("computed-hooper_total")).toHaveTextContent("8");
  });
});

describe("FormWizardView: session RPE (select, duration, chained calculations)", () => {
  it("hides inputs on a rest day and reveals the follow-up for a high load", async () => {
    const onSubmit = await renderForm(SPEC.schemas.session);
    expect(screen.queryByText("Step 1 of 1")).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Submit" })).toBeOnTheScreen();

    await press(field("session_type").getByRole("radio", { name: "Rest" }));
    expect(screen.queryByTestId("field-rpe")).not.toBeOnTheScreen();
    expect(screen.queryByTestId("field-duration")).not.toBeOnTheScreen();
    expect(screen.getByTestId("computed-srpe")).toHaveTextContent("0 AU");

    await press(field("session_type").getByRole("radio", { name: "Field" }));
    // CR-10 shows the number next to its descriptor.
    await press(field("rpe").getByRole("radio", { name: "8" }));
    await fireEvent.changeText(screen.getByTestId("input-duration-hours"), "1");
    await fireEvent.changeText(screen.getByTestId("input-duration-minutes"), "30");
    expect(screen.getByText("= 1 h 30 min. Up to 10 h.")).toBeOnTheScreen();
    expect(screen.getByTestId("computed-srpe")).toHaveTextContent("720 AU");
    expect(screen.getByTestId("computed-load_band")).toHaveTextContent("high");
    expect(screen.getByTestId("computed-duration_h")).toHaveTextContent("1.5 h");

    await next();
    expect(field("hard_reason").getByText("⚠ This field is required.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("input-hard_reason"), "Hills");
    await next();
    expect(onSubmit.mock.calls[0]![0].values).toEqual({
      session_type: "field",
      rpe: 8,
      duration: 90,
      hard_reason: "Hills",
    });
  });

  it("reports a non-number typed into a numeric field", async () => {
    await renderForm(SPEC.schemas.session);
    await press(field("session_type").getByRole("radio", { name: "Gym" }));
    await press(field("rpe").getByRole("radio", { name: "3 · Moderate" }));
    await fireEvent.changeText(screen.getByTestId("input-duration-minutes"), "4o");
    await next();
    expect(field("duration").getByText("⚠ Enter a number.")).toBeOnTheScreen();
  });
});

describe("FormWizardView: every field type", () => {
  it("renders and fills each type, and a section revealed by an answer becomes a new step", async () => {
    const onSubmit = await renderForm(SPEC.schemas.types);

    // info
    expect(screen.getByText("Read me")).toBeOnTheScreen();
    expect(screen.getByText("Instructions")).toBeOnTheScreen();

    // number with unit and range hint
    expect(field("mass").getByText("Between 30 and 200 kg.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("input-mass"), "72.4");

    // scale with 21 points (0-10 by 0.5) is a slider with -/+ buttons
    expect(field("rating").queryAllByRole("radio")).toHaveLength(0);
    await press(screen.getByRole("button", { name: "Increase Rating" }));
    await press(screen.getByRole("button", { name: "Increase Rating" }));
    expect(field("rating").getByText("0.5")).toBeOnTheScreen();

    // date / time / datetime pickers
    await press(screen.getByTestId("input-test_date"));
    await fireEvent(screen.getByTestId("input-test_date-picker"), "valueChange", {}, new Date(2026, 9, 12));
    expect(field("test_date").getByText("Monday 12 October")).toBeOnTheScreen();
    await press(screen.getByTestId("input-start_time"));
    await fireEvent(screen.getByTestId("input-start_time-picker"), "valueChange", {}, new Date(2026, 9, 12, 6, 45));
    expect(field("start_time").getByText("06:45")).toBeOnTheScreen();
    await press(screen.getByTestId("input-recorded_at"));
    await fireEvent(screen.getByTestId("input-recorded_at-picker"), "valueChange", {}, new Date(2026, 9, 12, 7, 5));
    expect(field("recorded_at").getByText("12 Oct 2026, 07:05")).toBeOnTheScreen();

    // text with max_length 5 shows a counter near the limit
    await fireEvent.changeText(screen.getByTestId("input-comment"), "fine!");
    expect(field("comment").getByText("5 / 5")).toBeOnTheScreen();

    // multiselect chips, select list, boolean
    await press(field("tags").getByRole("checkbox", { name: "A" }));
    await press(field("tags").getByRole("checkbox", { name: "C" }));
    await press(field("level").getByRole("radio", { name: "2 · Two" }));
    expect(screen.getByRole("button", { name: "Submit" })).toBeOnTheScreen();
    await press(field("flag").getByRole("radio", { name: "Yes" }));

    // The "extra" section is now a second step.
    expect(screen.getByText("Step 1 of 2")).toBeOnTheScreen();
    await next();
    expect(screen.getByRole("header", { name: "Extra" })).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("input-extra_value"), "21");
    expect(screen.getByTestId("computed-extra_double")).toHaveTextContent("42");
    await next();

    const { values, computed } = onSubmit.mock.calls[0]![0] as SubmissionValidation;
    expect(values).toMatchObject({
      mass: 72.4,
      rating: 0.5,
      test_date: "2026-10-12",
      start_time: "06:45",
      comment: "fine!",
      tags: ["a", "c"],
      level: 2,
      flag: true,
      extra_value: 21,
    });
    expect(values.recorded_at).toMatch(/^2026-10-12T07:05:00[+-]\d{2}:\d{2}$/);
    expect(computed).toEqual({ extra_double: 42 });
  });

  it("shows the engine's error messages for invalid answers", async () => {
    await renderForm(SPEC.schemas.types);
    await fireEvent.changeText(screen.getByTestId("input-mass"), "250");
    await fireEvent.changeText(screen.getByTestId("input-comment"), "toolong");
    await press(field("tags").getByRole("checkbox", { name: "B" }));
    await next();
    expect(field("mass").getByText("⚠ Must be between 30 kg and 200 kg.")).toBeOnTheScreen();
    expect(field("comment").getByText("⚠ Must be at most 5 characters.")).toBeOnTheScreen();
    expect(field("tags").getByText("⚠ Select at least 2 options.")).toBeOnTheScreen();
  });
});
