import { findField, type FormSchema } from "@ams/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import formCases from "../../../../spec/form-cases.json";
import { applyOutlineDrop, errorsForField, flattenOutline } from "@/components/builder/builder-logic";
import { FormBuilder } from "@/components/builder/FormBuilder";
import { TooltipProvider } from "@/components/ui/tooltip";

const wellness = (formCases.schemas as unknown as Record<string, FormSchema>).wellness!;

let latest: FormSchema = wellness;
function Harness({ initial = wellness, serverErrors }: { initial?: FormSchema; serverErrors?: { path: string; message: string }[] }) {
  const [schema, setSchema] = useState(initial);
  latest = schema;
  return (
    <TooltipProvider>
      <FormBuilder schema={schema} onChange={setSchema} serverErrors={serverErrors} />
    </TooltipProvider>
  );
}

const expressionOf = (key: string) => {
  const f = findField(latest, key)?.field as { expression?: string } | undefined;
  return f?.expression;
};

function outlineItem(key: string) {
  return document.querySelector<HTMLButtonElement>(`[data-field-key="${key}"]`)!;
}

describe("FormBuilder", () => {
  it("renaming a key rewrites expressions that reference it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(outlineItem("sleep_quality"));
    const key = screen.getByLabelText("Key");
    expect(key).toHaveValue("sleep_quality");
    expect(screen.getByText(/Used in 1 expression/)).toBeInTheDocument();
    await user.clear(key);
    await user.type(key, "sleep{Enter}");
    expect(findField(latest, "sleep")).toBeDefined();
    expect(findField(latest, "sleep_quality")).toBeUndefined();
    expect(expressionOf("hooper_total")).toBe("sum(sleep, fatigue, stress, soreness)");
    // the outline and selection follow the new key
    expect(outlineItem("sleep")).toHaveAttribute("aria-current", "true");
  });

  it("rejects invalid, reserved and duplicate keys without renaming", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(outlineItem("fatigue"));
    const key = screen.getByLabelText("Key");
    await user.clear(key);
    await user.type(key, "1abc");
    expect(screen.getByText(/Start with a lowercase letter/)).toBeInTheDocument();
    await user.clear(key);
    await user.type(key, "sum");
    expect(screen.getByText(/reserved word/)).toBeInTheDocument();
    await user.clear(key);
    await user.type(key, "stress");
    expect(screen.getByText("Another field already uses this key")).toBeInTheDocument();
    await user.tab();
    expect(findField(latest, "fatigue")).toBeDefined();
  });

  it("shows live expression errors inline and flags the field in the outline", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText("No errors")).toBeInTheDocument();
    await user.click(outlineItem("hooper_total"));
    const expr = screen.getByLabelText("Expression");
    await user.clear(expr);
    await user.type(expr, "sum(fatigue, stress");
    const status = document.getElementById("fe-expr-status")!;
    expect(status).toHaveClass("text-destructive");
    expect(status).toHaveTextContent(/ at /);
    expect(screen.getByRole("button", { name: /1 error/ })).toBeInTheDocument();
    expect(within(outlineItem("hooper_total")).getByRole("img", { name: "has errors" })).toBeInTheDocument();

    await user.clear(expr);
    await user.type(expr, "fatigue + mystery");
    expect(screen.getByText('Unknown field "mystery"')).toBeInTheDocument();

    await user.clear(expr);
    await user.type(expr, "fatigue * 2");
    expect(screen.getByText("Valid expression")).toBeInTheDocument();
    expect(screen.getByText("No errors")).toBeInTheDocument();
  });

  it("maps server schema_errors to fields", async () => {
    const user = userEvent.setup();
    render(<Harness serverErrors={[{ path: "sections/0/fields/0/label", message: "Label rejected by server" }]} />);
    expect(within(outlineItem("sleep_quality")).getByRole("img", { name: "has errors" })).toBeInTheDocument();
    await user.click(outlineItem("sleep_quality"));
    expect(screen.getByText("Label rejected by server")).toBeInTheDocument();
  });

  it("adds a field whose key follows its label until renamed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const addButtons = screen.getAllByRole("button", { name: "Add field" });
    await user.click(addButtons[1]!);
    await user.click(await screen.findByRole("menuitem", { name: "Number" }));
    expect(screen.getByLabelText("Key")).toHaveValue("number");
    const label = screen.getByLabelText("Label");
    await user.clear(label);
    await user.type(label, "Body mass");
    expect(screen.getByLabelText("Key")).toHaveValue("body_mass");
    expect(findField(latest, "body_mass")?.sectionIndex).toBe(1);
    // the live preview renders the new field
    expect(within(screen.getByRole("complementary", { name: "Live preview" })).getByLabelText("Body mass")).toBeInTheDocument();
  });

  it("live preview evaluates calculated fields with the shared engine", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const preview = within(screen.getByRole("complementary", { name: "Live preview" }));
    await user.click(preview.getAllByRole("radio", { name: "2" })[0]!);
    await user.click(preview.getAllByRole("radio", { name: "3" })[1]!);
    expect(preview.getByRole("status", { name: "Hooper index" })).toHaveTextContent("5");
  });
});

describe("outline drag and drop", () => {
  it("moves a field into another section", () => {
    const items = flattenOutline(wellness);
    expect(items.map((i) => i.id).slice(0, 3)).toEqual(["s-0", "f-0-0", "f-0-1"]);
    // drop sleep_hours (f-0-5) onto pain_score (f-1-2)
    const next = applyOutlineDrop(wellness, "f-0-5", "f-1-2");
    expect(next.sections[0]!.fields.map((f) => f.key)).not.toContain("sleep_hours");
    expect(next.sections[1]!.fields.map((f) => f.key)).toEqual(["has_pain", "pain_location", "pain_score", "sleep_hours"]);
  });

  it("reorders within a section and reorders sections", () => {
    const next = applyOutlineDrop(wellness, "f-0-0", "f-0-2");
    expect(next.sections[0]!.fields.slice(0, 3).map((f) => f.key)).toEqual(["fatigue", "stress", "sleep_quality"]);
    const swapped = applyOutlineDrop(wellness, "s-1", "s-0");
    expect(swapped.sections.map((s) => s.key)).toEqual(["pain", "wellness"]);
  });

  it("groups schema errors by field path", () => {
    expect(
      errorsForField([{ path: "sections/0/fields/4/expression", message: "bad" }, { path: "sections/0/fields/40/key", message: "x" }], "sections/0/fields/4"),
    ).toEqual([{ prop: "expression", message: "bad" }]);
  });
});
