import { describe, expect, it } from "vitest";
import { evaluate, evaluateExpression, parse } from "../src/expr";
import type { Value } from "../src/expr";
import { jsonClose, loadSpec } from "./helpers";

interface ExprCase {
  expr: string;
  vars?: Record<string, Value>;
  result?: Value;
  error?: true;
  parse_error?: true;
}

const spec = loadSpec<{ cases: ExprCase[] }>("expr-cases.json");

describe("spec/expr-cases.json", () => {
  it("has cases", () => {
    expect(spec.cases.length).toBeGreaterThan(100);
  });

  it.each(spec.cases.map((c, i) => [`#${i} ${c.expr}`, c] as const))("%s", (_name, c) => {
    const kinds = ["result", "error", "parse_error"].filter((k) => k in c);
    expect(kinds).toHaveLength(1);
    const parsed = parse(c.expr);
    if (c.parse_error) {
      expect(parsed.ok, `expected a parse error for ${JSON.stringify(c.expr)}`).toBe(false);
      return;
    }
    if (!parsed.ok) throw new Error(`unexpected parse error: ${parsed.error.message} at ${parsed.error.position}`);
    const res = evaluate(parsed.ast, c.vars ?? {});
    if (c.error) {
      expect(res.ok, `expected an evaluation error, got ${JSON.stringify(res)}`).toBe(false);
      return;
    }
    if (!res.ok) throw new Error(`unexpected evaluation error: ${res.error.message}`);
    expect(jsonClose(res.value, c.result), `got ${JSON.stringify(res.value)}, want ${JSON.stringify(c.result)}`).toBe(true);
    // The convenience wrapper agrees.
    expect(evaluateExpression(c.expr, c.vars ?? {})).toEqual(res);
  });
});
