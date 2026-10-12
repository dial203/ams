import { describe, expect, it } from "vitest";
import { compileForm, evaluateForm, validateSchema, validateSubmission } from "../src/forms";
import type { FormSchema } from "../src/forms";
import { jsonClose, loadSpec } from "./helpers";

interface FormCase {
  name: string;
  schema: string;
  values: Record<string, unknown>;
  expected: {
    ok: boolean;
    errors: Record<string, string>;
    values: Record<string, unknown>;
    computed: Record<string, unknown>;
    hidden: string[];
  };
}

interface SchemaCase {
  name: string;
  schema: unknown;
  error_paths: string[];
}

const formSpec = loadSpec<{ schemas: Record<string, FormSchema>; cases: FormCase[] }>("form-cases.json");
const schemaSpec = loadSpec<{ cases: SchemaCase[] }>("schema-cases.json");

function hiddenKeys(visible: Record<string, boolean>): string[] {
  return Object.keys(visible)
    .filter((k) => !visible[k])
    .sort();
}

describe("spec/form-cases.json", () => {
  it("every named schema is itself valid", () => {
    for (const [name, schema] of Object.entries(formSpec.schemas)) {
      expect(validateSchema(schema), name).toEqual([]);
    }
  });

  it.each(formSpec.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const schema = formSpec.schemas[c.schema]!;
    const res = validateSubmission(schema, c.values);
    expect(res.ok).toBe(c.expected.ok);
    expect(res.errors).toEqual(c.expected.errors);
    expect(res.values).toEqual(c.expected.values);
    expect(jsonClose(res.computed, c.expected.computed), `computed ${JSON.stringify(res.computed)}`).toBe(true);
    expect(hiddenKeys(res.visible)).toEqual([...c.expected.hidden].sort());

    // evaluateForm agrees with validate's evaluation, and a compiled form agrees with both.
    const ev = evaluateForm(schema, c.values);
    expect(ev.values).toEqual(res.values);
    expect(ev.visible).toEqual(res.visible);
    expect(jsonClose(ev.computed, res.computed)).toBe(true);
    expect(compileForm(schema).validate(c.values)).toEqual(res);
  });
});

describe("spec/schema-cases.json", () => {
  it.each(schemaSpec.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const errors = validateSchema(c.schema);
    const paths = Array.from(new Set(errors.map((e) => e.path))).sort();
    expect(paths).toEqual([...c.error_paths].sort());
    for (const e of errors) expect(e.message.length).toBeGreaterThan(0);
  });
});
