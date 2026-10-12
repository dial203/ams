import {
  errorMessage,
  findField,
  validateSubmission,
  type FormSchema,
  type FormValues,
  type SubmissionValidation,
} from "@ams/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import formCases from "../../../../spec/form-cases.json";
import { FormRenderer } from "@/components/forms/FormRenderer";
import { formatFieldValue } from "@/lib/field-format";

interface SpecCase {
  name: string;
  schema: string;
  values: FormValues;
  expected: {
    ok: boolean;
    errors: Record<string, string>;
    values: FormValues;
    computed: Record<string, unknown>;
    hidden: string[];
  };
}

const schemas = formCases.schemas as unknown as Record<string, FormSchema>;
const cases = formCases.cases as unknown as SpecCase[];

function fieldBlock(container: HTMLElement, key: string): HTMLElement | null {
  return container.querySelector(`[data-field="${key}"]`);
}

describe("FormRenderer against spec/form-cases.json", () => {
  it.each(Object.keys(schemas))("renders every visible field of the %s schema", (name) => {
    const schema = schemas[name]!;
    const { container } = render(<FormRenderer schema={schema} onSubmit={() => {}} />);
    const initial = validateSubmission(schema, {});
    for (const section of schema.sections) {
      for (const field of section.fields) {
        const block = fieldBlock(container, field.key);
        if (initial.visible[field.key]) {
          expect(block, field.key).not.toBeNull();
          expect(within(block!).getAllByText(field.label, { exact: false }).length).toBeGreaterThan(0);
        } else {
          expect(block, field.key).toBeNull();
        }
      }
    }
  });

  it.each(cases.map((c) => [c.name, c] as const))("case: %s", (_name, c) => {
    const schema = schemas[c.schema]!;
    const { container } = render(<FormRenderer schema={schema} initialValues={c.values} showAllErrors onSubmit={() => {}} />);
    // Hidden fields are not rendered; the others are.
    for (const key of c.expected.hidden) expect(fieldBlock(container, key), `${key} hidden`).toBeNull();
    for (const section of schema.sections) {
      for (const field of section.fields) {
        if (!c.expected.hidden.includes(field.key)) expect(fieldBlock(container, field.key), `${field.key} visible`).not.toBeNull();
      }
    }
    // Field errors appear under their field with the shared message.
    for (const [key, code] of Object.entries(c.expected.errors)) {
      if (code === "unknown_field") {
        expect(screen.getByText(/not in this form/)).toHaveTextContent(key);
        continue;
      }
      const loc = findField(schema, key)!;
      expect(within(fieldBlock(container, key)!).getByText(errorMessage(code, loc.field))).toBeInTheDocument();
    }
    // Calculated values are displayed as the engine computes them.
    for (const [key, value] of Object.entries(c.expected.computed)) {
      if (c.expected.hidden.includes(key)) continue;
      const loc = findField(schema, key)!;
      expect(within(fieldBlock(container, key)!).getByRole("status", { hidden: true }).textContent ?? "").toBe(
        formatFieldValue(loc.field, value),
      );
    }
  });
});

describe("FormRenderer interactions", () => {
  const wellness = schemas.wellness!;

  it("computes calculated values live and reveals conditional fields", async () => {
    const user = userEvent.setup();
    render(<FormRenderer schema={wellness} onSubmit={() => {}} />);
    const pick = (label: string, value: string) =>
      user.click(within(screen.getByRole("radiogroup", { name: label })).getByRole("radio", { name: value }));
    await pick("Sleep quality", "3");
    await pick("Fatigue", "4");
    expect(screen.getByRole("status", { name: "Hooper index" })).toHaveTextContent("7");
    await pick("Stress", "2");
    await pick("Muscle soreness", "5");
    expect(screen.getByRole("status", { name: "Hooper index" })).toHaveTextContent("14");

    expect(screen.queryByText("Where?")).not.toBeInTheDocument();
    await pick("Any pain or injury?", "Yes");
    expect(screen.getByText("Where?")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Pain (0-10)" })).toBeInTheDocument();
    await pick("Any pain or injury?", "No");
    expect(screen.queryByText("Where?")).not.toBeInTheDocument();
  });

  it("supports arrow keys inside a scale", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FormRenderer schema={wellness} onChange={onChange} />);
    const group = screen.getByRole("radiogroup", { name: "Sleep quality" });
    await user.click(within(group).getByRole("radio", { name: "3" }));
    await user.keyboard("{ArrowRight}");
    expect(within(group).getByRole("radio", { name: "4" })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getByRole("radio", { name: "4" })).toHaveFocus();
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ sleep_quality: 4 });
  });

  it("shows required errors only after the first submit and submits the engine payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(r: SubmissionValidation) => void>();
    render(<FormRenderer schema={wellness} onSubmit={onSubmit} submitLabel="Save" />);
    expect(screen.queryByText("This field is required.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText("This field is required.")).toHaveLength(5);

    const pick = (label: string, value: string) =>
      user.click(within(screen.getByRole("radiogroup", { name: `${label}` })).getByRole("radio", { name: value }));
    await pick("Sleep quality", "3");
    await pick("Fatigue", "4");
    await pick("Stress", "2");
    await pick("Muscle soreness", "5");
    await pick("Any pain or injury?", "Yes");
    await user.click(screen.getByRole("checkbox", { name: "Knee" }));
    await pick("Pain (0-10)", "6");
    await user.type(screen.getByLabelText("Hours slept"), "7.5");
    expect(screen.queryByText("This field is required.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const result = onSubmit.mock.calls[0]![0];
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({
      sleep_quality: 3,
      fatigue: 4,
      stress: 2,
      soreness: 5,
      sleep_hours: 7.5,
      has_pain: true,
      pain_location: ["knee"],
      pain_score: 6,
    });
    expect(result.computed).toEqual({ hooper_total: 14 });
  });

  it("drops values of fields that become hidden", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(r: SubmissionValidation) => void>();
    render(
      <FormRenderer
        schema={wellness}
        initialValues={{ sleep_quality: 1, fatigue: 1, stress: 1, soreness: 1, has_pain: true, pain_location: ["hip"], pain_score: 3 }}
        onSubmit={onSubmit}
      />,
    );
    await user.click(within(screen.getByRole("radiogroup", { name: "Any pain or injury?" })).getByRole("radio", { name: "No" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit.mock.calls[0]![0].values).toEqual({ sleep_quality: 1, fatigue: 1, stress: 1, soreness: 1, has_pain: false });
  });

  it("limits multiselect choices to max_selected", async () => {
    const user = userEvent.setup();
    render(<FormRenderer schema={wellness} initialValues={{ has_pain: true }} />);
    await user.click(screen.getByRole("checkbox", { name: "Ankle" }));
    await user.click(screen.getByRole("checkbox", { name: "Knee" }));
    await user.click(screen.getByRole("checkbox", { name: "Hip" }));
    expect(screen.getByRole("checkbox", { name: "Hip" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: "Hip" })).toHaveAttribute("aria-disabled", "true");
  });

  it("session form: rest hides inputs, select dropdown and h:m duration feed the calculation", async () => {
    const user = userEvent.setup();
    render(<FormRenderer schema={schemas.session!} />);
    const type = screen.getByRole("radiogroup", { name: "Type" });
    await user.click(within(type).getByRole("radio", { name: "Rest" }));
    expect(screen.queryByLabelText(/Session RPE/)).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Session load" })).toHaveTextContent("0 AU");

    await user.click(within(type).getByRole("radio", { name: "Field" }));
    // 11 options -> dropdown
    await user.selectOptions(screen.getByLabelText(/Session RPE/), "Hard");
    await user.type(screen.getByRole("textbox", { name: "Hours" }), "1");
    await user.type(screen.getByRole("textbox", { name: "Minutes" }), "30");
    expect(screen.getByRole("status", { name: "Session load" })).toHaveTextContent("450 AU");
    expect(screen.getByRole("status", { name: "Band" })).toHaveTextContent("moderate");
    expect(screen.getByRole("status", { name: "Duration (h)" })).toHaveTextContent("1.5 h");
  });

  it("types form: section visibility, blur validation and invalid number text", async () => {
    const user = userEvent.setup();
    render(<FormRenderer schema={schemas.types!} />);
    expect(screen.queryByText("Extra")).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("radiogroup", { name: "Flag" })).getByRole("radio", { name: "Yes" }));
    expect(screen.getByRole("textbox", { name: "Extra" })).toBeInTheDocument();

    const mass = screen.getByLabelText("Body mass");
    await user.type(mass, "abc");
    expect(screen.queryByText("Enter a number.")).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByText("Enter a number.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Comment"), "too long");
    await user.tab();
    expect(screen.getByText("Must be at most 5 characters.")).toBeInTheDocument();
    expect(screen.getByText("8/5")).toBeInTheDocument();
  });

  it("read-only mode shows formatted values without inputs", () => {
    render(
      <FormRenderer
        schema={schemas.session!}
        readOnly
        initialValues={{ session_type: "field", rpe: 5, duration: 90 }}
      />,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("Field")).toBeInTheDocument();
    expect(screen.getByText("Hard")).toBeInTheDocument();
    expect(screen.getByText("1 h 30 min")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Session load" })).toHaveTextContent("450 AU");
  });

  it("shows server field errors until the field changes", async () => {
    const user = userEvent.setup();
    render(
      <FormRenderer
        schema={schemas.types!}
        initialValues={{ mass: 80 }}
        serverErrors={{ mass: "out_of_range" }}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByText("Must be between 30 kg and 200 kg.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Body mass"), { target: { value: "81" } });
    expect(screen.queryByText("Must be between 30 kg and 200 kg.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit" }));
  });
});
