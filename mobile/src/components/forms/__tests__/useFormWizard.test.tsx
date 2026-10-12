import { act, renderHook } from "@testing-library/react-native";
import { SPEC } from "../../../test/fixtures";
import { useFormWizard } from "../useFormWizard";

/** Relative tolerance of spec/form-cases.json for computed numbers. */
function expectComputed(actual: Record<string, unknown>, expected: Record<string, unknown>) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [k, v] of Object.entries(expected)) {
    const a = actual[k];
    if (typeof v === "number" && typeof a === "number") {
      expect(Math.abs(a - v)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(v)));
    } else {
      expect(a).toEqual(v);
    }
  }
}

describe("useFormWizard against spec/form-cases.json", () => {
  it.each(SPEC.cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const schema = SPEC.schemas[c.schema];
    const { result } = await renderHook(() => useFormWizard(schema));

    // Enter every value the way the renderer does: one field at a time.
    await act(async () => {
      for (const [key, value] of Object.entries(c.values)) result.current.setValue(key, value);
    });

    let validation!: ReturnType<typeof result.current.validateAll>;
    await act(async () => {
      validation = result.current.validateAll();
    });

    expect(validation.ok).toBe(c.expected.ok);
    expect(validation.errors).toEqual(c.expected.errors);
    expect(validation.values).toEqual(c.expected.values);
    expectComputed(validation.computed, c.expected.computed);

    // Visibility drives the wizard: hidden fields never appear on any step.
    const shown = new Set(result.current.steps.flatMap((s) => s.fields.map((f) => f.key)));
    for (const hidden of c.expected.hidden) expect(shown.has(hidden)).toBe(false);
    const hiddenSet = new Set(c.expected.hidden);
    for (const section of schema.sections) {
      for (const field of section.fields) {
        if (!hiddenSet.has(field.key)) expect(shown.has(field.key)).toBe(true);
      }
    }

    // Errors shown under fields are exactly the engine's, and the wizard sits on the first
    // section that has one.
    expect(result.current.errors).toEqual(c.expected.ok ? {} : c.expected.errors);
    if (!c.expected.ok) {
      const firstErrorStep = result.current.steps.findIndex((s) => s.fields.some((f) => f.key in c.expected.errors));
      if (firstErrorStep !== -1) expect(result.current.stepIndex).toBe(firstErrorStep);
    }
  });
});

describe("useFormWizard navigation", () => {
  it("validates one section at a time and skips sections that become hidden", async () => {
    const { result } = await renderHook(() => useFormWizard(SPEC.schemas.types));
    expect(result.current.steps.map((s) => s.key)).toEqual(["main"]);

    await act(async () => result.current.setValue("flag", true));
    expect(result.current.steps.map((s) => s.key)).toEqual(["main", "extra"]);
    expect(result.current.isLast).toBe(false);

    // "main" has no required fields, but an invalid answer blocks Next.
    await act(async () => result.current.setValue("comment", "far too long"));
    let moved = true;
    await act(async () => {
      moved = result.current.next();
    });
    expect(moved).toBe(false);
    expect(result.current.errors).toEqual({ comment: "too_long" });

    // Editing a field clears its error.
    await act(async () => result.current.setValue("comment", "ok"));
    expect(result.current.errors).toEqual({});
    await act(async () => {
      moved = result.current.next();
    });
    expect(moved).toBe(true);
    expect(result.current.current?.key).toBe("extra");

    // Hiding the current section falls back to the closest earlier one.
    await act(async () => result.current.setValue("flag", false));
    expect(result.current.current?.key).toBe("main");
    expect(result.current.isLast).toBe(true);
  });

  it("maps server field errors to their fields and jumps to the first", async () => {
    const { result } = await renderHook(() => useFormWizard(SPEC.schemas.wellness));
    await act(async () => result.current.setValue("has_pain", true));
    await act(async () => result.current.goToStep(1));
    let unknown: string[] = [];
    await act(async () => {
      unknown = result.current.applyServerErrors({ fatigue: "out_of_range", ghost: "unknown_field" });
    });
    expect(unknown).toEqual(["ghost"]);
    expect(result.current.errors).toEqual({ fatigue: "out_of_range", ghost: "unknown_field" });
    expect(result.current.current?.key).toBe("wellness");
  });

  it("keeps answers of hidden fields while editing but never submits them", async () => {
    const { result } = await renderHook(() => useFormWizard(SPEC.schemas.wellness));
    await act(async () => {
      result.current.setValue("has_pain", true);
      result.current.setValue("pain_score", 4);
      result.current.setValue("has_pain", false);
    });
    expect(result.current.values.pain_score).toBe(4);
    expect(result.current.evaluation.values.pain_score).toBeUndefined();
    await act(async () => result.current.setValue("has_pain", true));
    expect(result.current.evaluation.values.pain_score).toBe(4);
  });
});
