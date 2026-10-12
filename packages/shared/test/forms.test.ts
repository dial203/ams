import { describe, expect, it } from "vitest";
import {
  FIELD_TYPES,
  compileForm,
  emptySchema,
  errorMessage,
  evaluateForm,
  fieldKeys,
  findField,
  findReferences,
  inputFields,
  insertField,
  insertSection,
  isEmptyValue,
  isValidDateTimeString,
  moveField,
  moveSection,
  newField,
  newSection,
  removeField,
  removeSection,
  renameField,
  renameKeyInExpressions,
  scaleDisplay,
  scaleValues,
  slugifyKey,
  uniqueKey,
  updateField,
  updateSection,
  validateFieldValue,
  validateSchema,
  validateSubmission,
  valueFields,
} from "../src/forms";
import type { Field, FormSchema } from "../src/forms";

const wellness: FormSchema = {
  schema_version: 1,
  sections: [
    {
      key: "wellness",
      title: "Wellness",
      fields: [
        { key: "intro", type: "info", label: "Hi" },
        { key: "sleep", type: "scale", label: "Sleep", min: 1, max: 7, required: true },
        { key: "sleep_hours", type: "number", label: "Hours", min: 0, max: 24 },
        { key: "total", type: "calculated", label: "Total", expression: "sum(sleep, sleep_hours) + if(sleep > 3, sleep, 0)" },
      ],
    },
    {
      key: "more",
      title: "More",
      visible_if: "sleep  >=  5 and 'sleep' != ''",
      fields: [
        { key: "note", type: "text", label: "Note", visible_if: "total > sleep" },
        { key: "tags", type: "multiselect", label: "Tags", options: [{ value: "a", label: "A" }] },
      ],
    },
  ],
};

describe("field helpers", () => {
  it("lists keys and value/input fields in schema order", () => {
    expect(fieldKeys(wellness)).toEqual(["intro", "sleep", "sleep_hours", "total", "note", "tags"]);
    expect(valueFields(wellness).map((f) => f.key)).toEqual(["sleep", "sleep_hours", "total", "note", "tags"]);
    expect(inputFields(wellness).map((f) => f.key)).toEqual(["sleep", "sleep_hours", "note", "tags"]);
    expect(findField(wellness, "note")).toMatchObject({ sectionIndex: 1, fieldIndex: 0, index: 4, path: "sections/1/fields/0" });
    expect(findField(wellness, "nope")).toBeUndefined();
  });

  it("isEmptyValue: undefined, null, '' and [] only", () => {
    for (const v of [undefined, null, "", []]) expect(isEmptyValue(v)).toBe(true);
    for (const v of [0, false, " ", [null], {}]) expect(isEmptyValue(v)).toBe(false);
  });

  it("scale points and display", () => {
    expect(scaleValues({ min: 0, max: 1, step: 0.1 })).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(scaleValues({ min: 1, max: 7 })).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(scaleValues({ min: 0, max: 10, step: 3 })).toEqual([0, 3, 6, 9]);
    expect(scaleDisplay({ min: 0, max: 10 })).toBe("buttons");
    expect(scaleDisplay({ min: 0, max: 11 })).toBe("slider");
    expect(scaleDisplay({ min: 0, max: 100, display: "buttons" })).toBe("buttons");
  });
});

describe("evaluateForm beyond the spec vectors", () => {
  it("tolerates malformed and invalid schemas without throwing", () => {
    expect(evaluateForm({ schema_version: 1, sections: null } as unknown as FormSchema, { a: 1 })).toEqual({
      visible: {},
      computed: {},
      values: {},
    });
    const cyclic: FormSchema = {
      schema_version: 1,
      sections: [
        {
          key: "s",
          title: "S",
          fields: [
            { key: "a", type: "calculated", label: "A", expression: "b + 1" },
            { key: "b", type: "calculated", label: "B", expression: "a + 1" },
            { key: "c", type: "calculated", label: "C", expression: "1 +" },
            { key: "d", type: "number", label: "D", visible_if: "nope(" },
          ],
        },
      ],
    };
    expect(evaluateForm(cyclic, { d: 1 })).toEqual({
      visible: { a: true, b: true, c: true, d: false },
      computed: { a: null, b: null, c: null },
      values: {},
    });
    expect(evaluateForm(wellness, null).values).toEqual({});
  });

  it("orders calculations topologically, ties by schema order", () => {
    const schema: FormSchema = {
      schema_version: 1,
      sections: [
        {
          key: "s",
          title: "S",
          fields: [
            { key: "x", type: "number", label: "X" },
            { key: "c", type: "calculated", label: "C", expression: "b * 2" },
            { key: "a", type: "calculated", label: "A", expression: "x + 1" },
            { key: "b", type: "calculated", label: "B", expression: "a + c0" },
            { key: "c0", type: "calculated", label: "C0", expression: "10" },
          ],
        },
      ],
    };
    const compiled = compileForm(schema);
    expect(compiled.calculationOrder).toEqual(["a", "c0", "b", "c"]);
    expect(compiled.evaluate({ x: 1 }).computed).toEqual({ c: 24, a: 2, b: 12, c0: 10 });
  });

  it("terminates on oscillating visibility after fields + 1 rounds", () => {
    const schema: FormSchema = {
      schema_version: 1,
      sections: [
        {
          key: "s",
          title: "S",
          fields: [
            { key: "a", type: "number", label: "A", visible_if: "b == null" },
            { key: "b", type: "number", label: "B", visible_if: "a == null" },
          ],
        },
      ],
    };
    // Round 1 hides both, round 2 shows both, round 3 hides both; the loop stops there.
    expect(evaluateForm(schema, { a: 1, b: 1 })).toEqual({ visible: { a: false, b: false }, computed: {}, values: {} });
  });

  it("works with keys that collide with Object.prototype", () => {
    const schema: FormSchema = {
      schema_version: 1,
      sections: [
        {
          key: "s",
          title: "S",
          fields: [
            { key: "constructor", type: "number", label: "C" },
            { key: "value_of", type: "calculated", label: "V", expression: "constructor * 2" },
          ],
        },
      ],
    };
    expect(validateSchema(schema)).toEqual([]);
    expect(validateSubmission(schema, { constructor: 2 })).toMatchObject({
      ok: true,
      values: { constructor: 2 },
      computed: { value_of: 4 },
    });
    const res = validateSubmission(schema, JSON.parse('{"__proto__": 1, "to_string": 2}') as Record<string, unknown>);
    expect(Object.keys(res.errors).sort()).toEqual(["__proto__", "to_string"]);
    expect(Object.getPrototypeOf(res.errors)).toBe(Object.prototype);
  });

  it("returns plain objects that serialise like the server's", () => {
    const res = validateSubmission(wellness, { sleep: 6, sleep_hours: "", tags: [] });
    expect(JSON.parse(JSON.stringify(res))).toEqual({
      ok: true,
      errors: {},
      values: { sleep: 6 },
      computed: { total: 12 },
      visible: { intro: true, sleep: true, sleep_hours: true, total: true, note: true, tags: true },
    });
  });
});

describe("validateFieldValue", () => {
  const f = (field: Partial<Field> & { type: Field["type"] }) => ({ key: "k", label: "K", ...field }) as Field;

  it("checks types strictly", () => {
    expect(validateFieldValue(f({ type: "number" }), Number.NaN)).toBe("invalid_type");
    expect(validateFieldValue(f({ type: "duration" }), "10")).toBe("invalid_type");
    expect(validateFieldValue(f({ type: "select", options: [{ value: 1, label: "1" }] }), true)).toBe("invalid_type");
    expect(validateFieldValue(f({ type: "boolean" }), 0)).toBe("invalid_type");
    expect(validateFieldValue(f({ type: "multiselect", options: [] }), "a")).toBe("invalid_type");
    expect(validateFieldValue(f({ type: "time" }), 630)).toBe("invalid_type");
  });

  it("checks date, time and datetime formats", () => {
    const date = f({ type: "date" });
    expect(validateFieldValue(date, "2024-02-29")).toBeNull();
    expect(validateFieldValue(date, "2023-02-29")).toBe("invalid_format");
    expect(validateFieldValue(date, "1900-02-29")).toBe("invalid_format");
    expect(validateFieldValue(date, "2000-02-29")).toBeNull();
    expect(validateFieldValue(date, "0000-01-01")).toBe("invalid_format");
    expect(validateFieldValue(date, "2026-1-05")).toBe("invalid_format");
    const time = f({ type: "time" });
    expect(validateFieldValue(time, "23:59")).toBeNull();
    expect(validateFieldValue(time, "7:30")).toBe("invalid_format");
    expect(validateFieldValue(time, "12:60")).toBe("invalid_format");
    expect(validateFieldValue(time, "12:30:00")).toBe("invalid_format");
    for (const ok of ["2026-10-12T06:31Z", "2026-10-12T06:31:00.123456789+05:30", "2026-10-12T23:59:59-23:59"]) {
      expect(isValidDateTimeString(ok), ok).toBe(true);
    }
    for (const bad of [
      "2026-10-12T06:31:00",
      "2026-10-12 06:31:00Z",
      "2026-10-12T24:00:00Z",
      "2026-10-12T06:31:60Z",
      "2026-10-12T06:31:00+24:00",
      "2026-02-30T06:31:00Z",
      "2026-10-12T06:31:00.1234567890Z",
      "2026-10-12t06:31:00z",
    ]) {
      expect(isValidDateTimeString(bad), bad).toBe(false);
    }
  });

  it("counts text length in code points", () => {
    const text = f({ type: "text", max_length: 3 });
    expect(validateFieldValue(text, "😀😀😀")).toBeNull();
    expect(validateFieldValue(text, "😀😀😀😀")).toBe("too_long");
    expect(validateFieldValue(f({ type: "text" }), "x".repeat(500))).toBeNull();
    expect(validateFieldValue(f({ type: "text" }), "x".repeat(501))).toBe("too_long");
    expect(validateFieldValue(f({ type: "textarea" }), "x".repeat(5001))).toBe("too_long");
  });

  it("applies grid then range for scales, with floating-point tolerance", () => {
    const scale = f({ type: "scale", min: 0, max: 1, step: 0.1 });
    expect(validateFieldValue(scale, 0.3)).toBeNull();
    expect(validateFieldValue(scale, 0.35)).toBe("invalid_step");
    expect(validateFieldValue(scale, 1.1)).toBe("out_of_range");
    expect(validateFieldValue(f({ type: "scale", min: 1, max: 5 }), -1)).toBe("out_of_range");
  });

  it("checks select options by language equality and multiselect duplicates", () => {
    const sel = f({ type: "select", options: [{ value: 1, label: "One" }, { value: 2, label: "Two" }] });
    expect(validateFieldValue(sel, 2.0)).toBeNull();
    expect(validateFieldValue(sel, "2")).toBe("invalid_option");
    const multi = f({ type: "multiselect", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], max_selected: 1 });
    expect(validateFieldValue(multi, ["a", "a"])).toBe("invalid_option");
    expect(validateFieldValue(multi, ["a", "b"])).toBe("out_of_range");
    expect(validateFieldValue(multi, [true])).toBe("invalid_option");
  });

  it("only flags empty values when required", () => {
    expect(validateFieldValue(f({ type: "text", required: true }), "")).toBe("required");
    expect(validateFieldValue(f({ type: "multiselect", options: [], required: true }), [])).toBe("required");
    expect(validateFieldValue(f({ type: "number" }), null)).toBeNull();
    expect(validateFieldValue(f({ type: "number", required: true }), 0)).toBeNull();
  });
});

describe("validateSchema beyond the spec vectors", () => {
  const one = (field: Record<string, unknown>) => ({
    schema_version: 1,
    sections: [{ key: "s", title: "S", fields: [{ key: "a", label: "A", ...field }] }],
  });
  const paths = (schema: unknown) => validateSchema(schema).map((e) => e.path).sort();

  it("handles non-object input", () => {
    expect(paths(null)).toEqual([""]);
    expect(paths({ schema_version: 1 })).toEqual(["sections"]);
    expect(paths({ schema_version: 1, sections: [1] })).toEqual(["sections/0"]);
  });

  it("checks section keys, titles and field objects", () => {
    expect(
      paths({
        schema_version: 1,
        sections: [
          { key: "Bad", fields: [{ key: "a", type: "number", label: "A" }, "x"] },
          { key: "sum", title: "Reserved words are fine for sections", fields: [{ key: "b", type: "boolean", label: "B" }] },
        ],
      }),
    ).toEqual(["sections/0/fields/1", "sections/0/key", "sections/0/title"]);
  });

  it("checks optional keys when present", () => {
    expect(paths(one({ type: "number", step: 0, decimals: 1.5, min: 5, max: 1 }))).toEqual([
      "sections/0/fields/0/decimals",
      "sections/0/fields/0/max",
      "sections/0/fields/0/step",
    ]);
    expect(paths(one({ type: "scale", max: 5, display: "dial", anchors: { min: 1 } }))).toEqual([
      "sections/0/fields/0/anchors",
      "sections/0/fields/0/display",
      "sections/0/fields/0/min",
    ]);
    expect(paths(one({ type: "text", max_length: 0 }))).toEqual(["sections/0/fields/0/max_length"]);
    expect(paths(one({ type: "date", min: "2026-02-30", max: "2020-01-01" }))).toEqual(["sections/0/fields/0/min"]);
    expect(paths(one({ type: "date", min: "2026-01-01", max: "2020-01-01" }))).toEqual(["sections/0/fields/0/max"]);
    expect(
      paths(one({ type: "multiselect", options: [{ value: "a", label: "A" }], min_selected: 2, max_selected: 1 })),
    ).toEqual(["sections/0/fields/0/max_selected"]);
    expect(paths(one({ type: "select", options: [{ value: true, label: "T" }] }))).toEqual(["sections/0/fields/0/options"]);
    expect(paths(one({ type: "select", options: [{ value: "x" }] }))).toEqual(["sections/0/fields/0/options"]);
    expect(paths(one({ type: "calculated", expression: "   " }))).toEqual(["sections/0/fields/0/expression"]);
    expect(paths(one({ type: "number", visible_if: 5 }))).toEqual(["sections/0/fields/0/visible_if"]);
    expect(paths(one({ type: "number", visible_if: null }))).toEqual([]);
  });

  it("reports every member of a cycle even when one member also has a bad reference", () => {
    const schema = {
      schema_version: 1,
      sections: [
        {
          key: "s",
          title: "S",
          fields: [
            { key: "x", type: "calculated", label: "X", expression: "y + missing" },
            { key: "y", type: "calculated", label: "Y", expression: "x" },
            { key: "z", type: "calculated", label: "Z", expression: "y" },
          ],
        },
      ],
    };
    const errors = validateSchema(schema);
    expect(errors.map((e) => e.path).sort()).toEqual(["sections/0/fields/0/expression", "sections/0/fields/1/expression"]);
    expect(errors.find((e) => e.path.endsWith("0/expression"))!.message).toMatch(/missing/);
    expect(errors.find((e) => e.path.endsWith("1/expression"))!.message).toMatch(/Circular calculation: x -> y -> x/);
  });

  it("accepts calculated and visible_if references to calculated fields", () => {
    const schema = one({ type: "number" }) as unknown as FormSchema;
    schema.sections[0]!.fields.push(
      { key: "b", type: "calculated", label: "B", expression: "a" },
      { key: "c", type: "text", label: "C", visible_if: "b > 1" },
    );
    expect(validateSchema(schema)).toEqual([]);
  });
});

describe("errorMessage", () => {
  it("is specific when the field is given", () => {
    expect(errorMessage("required")).toBe("This field is required.");
    expect(errorMessage("out_of_range", { key: "m", type: "number", label: "M", min: 30, max: 200, unit: "kg" })).toBe(
      "Must be between 30 kg and 200 kg.",
    );
    expect(errorMessage("out_of_range", { key: "m", type: "duration", label: "D", min: 0 })).toBe("Must be at least 0.");
    expect(
      errorMessage("out_of_range", { key: "t", type: "multiselect", label: "T", options: [], min_selected: 2 }),
    ).toBe("Select at least 2 options.");
    expect(errorMessage("out_of_range", { key: "d", type: "date", label: "D", max: "2030-12-31" })).toBe(
      "Enter a date on or before 2030-12-31.",
    );
    expect(errorMessage("too_long", { key: "c", type: "text", label: "C", max_length: 1 })).toBe("Must be at most 1 character.");
    expect(errorMessage("invalid_step", { key: "r", type: "scale", label: "R", min: 0, max: 10, step: 0.5 })).toBe(
      "Choose a value in steps of 0.5 from 0.",
    );
    expect(errorMessage("invalid_format", { key: "t", type: "time", label: "T" })).toMatch(/HH:MM/);
    expect(errorMessage("something_new")).toBe("This value is not valid.");
  });
});

describe("builder: newField / emptySchema / slugifyKey", () => {
  it("newField returns a valid field for every type", () => {
    const fields = FIELD_TYPES.map((t) => newField(t, `f_${t}`));
    const schema: FormSchema = { ...emptySchema(), sections: [{ ...newSection("main"), fields }] };
    expect(validateSchema(schema)).toEqual([]);
    expect(newField("scale", "s")).toEqual({ key: "s", type: "scale", label: "Scale", min: 1, max: 10, step: 1 });
    expect(newField("text", "t", "Comment")).toEqual({ key: "t", type: "text", label: "Comment" });
    expect(emptySchema()).toEqual({ schema_version: 1, sections: [] });
  });

  it("slugifyKey makes valid, unique keys", () => {
    expect(slugifyKey("Sleep quality")).toBe("sleep_quality");
    expect(slugifyKey("  Muscle soreness (0–10)! ")).toBe("muscle_soreness_0_10");
    expect(slugifyKey("Ünïcödé Straße")).toBe("unicode_strasse");
    expect(slugifyKey("10 m sprint")).toBe("f_10_m_sprint");
    expect(slugifyKey("???")).toBe("field");
    expect(slugifyKey("Sum")).toBe("sum_2");
    expect(slugifyKey("If")).toBe("if_2");
    expect(slugifyKey("Sleep", ["sleep", "sleep_2"])).toBe("sleep_3");
    const long = slugifyKey("x".repeat(100), ["x".repeat(63)]);
    expect(long).toBe(`${"x".repeat(61)}_2`);
    expect(long.length).toBe(63);
    expect(uniqueKey("field", new Set(["field"]))).toBe("field_2");
  });
});

describe("builder: structure edits", () => {
  const schema: FormSchema = {
    schema_version: 1,
    sections: [
      { ...newSection("one"), fields: [newField("number", "a"), newField("number", "b"), newField("number", "c")] },
      { ...newSection("two"), fields: [newField("text", "d")] },
    ],
  };
  const keys = (s: FormSchema) => s.sections.map((x) => x.fields.map((f) => f.key));
  const snapshot = JSON.stringify(schema);

  it("moveField within and across sections", () => {
    expect(keys(moveField(schema, "a", 0, 2))).toEqual([["b", "c", "a"], ["d"]]);
    expect(keys(moveField(schema, "c", 0, 0))).toEqual([["c", "a", "b"], ["d"]]);
    expect(keys(moveField(schema, "b", 1, 0))).toEqual([["a", "c"], ["b", "d"]]);
    expect(keys(moveField(schema, "d", 0, 99))).toEqual([["a", "b", "c", "d"], []]);
    expect(moveField(schema, "b", 0, 1)).toBe(schema);
    expect(moveField(schema, "nope", 0, 0)).toBe(schema);
    expect(moveField(schema, "a", 5, 0)).toBe(schema);
    const moved = moveField(schema, "b", 1, 0);
    expect(moved.sections[1]).not.toBe(schema.sections[1]);
    expect(JSON.stringify(schema)).toBe(snapshot);
  });

  it("moves, inserts, updates and removes sections and fields immutably", () => {
    expect(moveSection(schema, 1, 0).sections.map((s) => s.key)).toEqual(["two", "one"]);
    expect(moveSection(schema, 0, 0)).toBe(schema);
    expect(insertSection(schema, newSection("zero"), 0).sections.map((s) => s.key)).toEqual(["zero", "one", "two"]);
    expect(removeSection(schema, 0).sections.map((s) => s.key)).toEqual(["two"]);
    expect(updateSection(schema, 1, { title: "Two" }).sections[1]!.title).toBe("Two");
    expect(keys(insertField(schema, 1, newField("boolean", "e"), 0))).toEqual([["a", "b", "c"], ["e", "d"]]);
    expect(keys(insertField(schema, 1, newField("boolean", "e")))).toEqual([["a", "b", "c"], ["d", "e"]]);
    expect(keys(removeField(schema, "b"))).toEqual([["a", "c"], ["d"]]);
    const updated = updateField(schema, "d", { label: "Notes", required: true });
    expect(updated.sections[1]!.fields[0]).toEqual({ key: "d", type: "text", label: "Notes", required: true });
    expect(updated.sections[0]).toBe(schema.sections[0]);
    expect(updateField(schema, "a", (f) => ({ ...f, help: "h" })).sections[0]!.fields[0]!.help).toBe("h");
    expect(JSON.stringify(schema)).toBe(snapshot);
  });
});

describe("renameKeyInExpressions / renameField / findReferences", () => {
  it("rewrites references in calculated expressions, field and section visible_if", () => {
    const renamed = renameKeyInExpressions(wellness, "sleep", "sleep_quality");
    const s0 = renamed.sections[0]!;
    const s1 = renamed.sections[1]!;
    expect(s0.fields[3]).toMatchObject({
      expression: "sum(sleep_quality, sleep_hours) + if(sleep_quality > 3, sleep_quality, 0)",
    });
    // Strings, other identifiers and spacing are untouched.
    expect(s1.visible_if).toBe("sleep_quality  >=  5 and 'sleep' != ''");
    expect(s1.fields[0]!.visible_if).toBe("total > sleep_quality");
    // The field key itself is unchanged and untouched objects are shared.
    expect(s0.fields[1]!.key).toBe("sleep");
    expect(s0.fields[0]).toBe(wellness.sections[0]!.fields[0]);
    expect(s1.fields[1]).toBe(wellness.sections[1]!.fields[1]);
    expect(renameKeyInExpressions(wellness, "absent", "x")).toBe(wellness);
  });

  it("renameField renames the key too, keeping the schema valid", () => {
    expect(validateSchema(wellness)).toEqual([]);
    const renamed = renameField(wellness, "sleep", "sleep_quality");
    expect(fieldKeys(renamed)).toEqual(["intro", "sleep_quality", "sleep_hours", "total", "note", "tags"]);
    expect(validateSchema(renamed)).toEqual([]);
    expect(evaluateForm(wellness, { sleep: 6, sleep_hours: 8 }).computed).toEqual({ total: 20 });
    expect(evaluateForm(renamed, { sleep_quality: 6, sleep_hours: 8 })).toEqual({
      visible: { intro: true, sleep_quality: true, sleep_hours: true, total: true, note: true, tags: true },
      computed: { total: 20 },
      values: { sleep_quality: 6, sleep_hours: 8 },
    });
  });

  it("findReferences lists the expressions that use a key", () => {
    expect(findReferences(wellness, "sleep")).toEqual([
      { path: "sections/0/fields/3/expression", owner: "total", section: false, property: "expression" },
      { path: "sections/1/visible_if", owner: "more", section: true, property: "visible_if" },
      { path: "sections/1/fields/0/visible_if", owner: "note", section: false, property: "visible_if" },
    ]);
    expect(findReferences(wellness, "tags")).toEqual([]);
  });
});
