import { describe, expect, it } from "vitest";
import {
  FUNCTION_NAMES,
  RESERVED_WORDS,
  evaluate,
  evaluateExpression,
  identifierNodes,
  isReservedWord,
  references,
  renameIdentifier,
  roundHalfAwayFromZero,
  valuesEqual,
} from "../src/expr";
import type { Expr, Value } from "../src/expr";
import { parse } from "../src/expr";

function value(src: string, env: Record<string, unknown> = {}): Value {
  const r = evaluateExpression(src, env);
  if (!r.ok) throw new Error(`${r.stage}: ${r.error.message}`);
  return r.value;
}

/** Asserts an evaluation (not parse) error and returns it. */
function failure(src: string, env: Record<string, unknown> = {}) {
  const r = evaluateExpression(src, env);
  if (r.ok) throw new Error(`expected an error, got ${JSON.stringify(r.value)}`);
  if (r.stage !== "evaluate") throw new Error(`unexpected parse error: ${r.error.message}`);
  return r;
}

function refs(src: string): string[] {
  const r = parse(src);
  if (!r.ok) throw new Error(r.error.message);
  return references(r.ast);
}

describe("evaluate: null propagation and types", () => {
  it("null wins over type errors in arithmetic", () => {
    expect(value("x + 'a'", { x: null })).toBeNull();
    expect(value("x * true", { x: null })).toBeNull();
    expect(value("-x", { x: null })).toBeNull();
    expect(value("x ^ 2", { x: null })).toBeNull();
  });

  it("reports type errors with a kind and the failing node", () => {
    const r = failure("1 + (2 * 'a')");
    expect(r).toMatchObject({ stage: "evaluate", error: { kind: "type", position: 5, end: 12 } });
    expect(failure("-true").error).toMatchObject({ kind: "type", position: 0 });
    expect(failure("xs + 1", { xs: [1] }).error.kind).toBe("type");
    expect(failure("'a' - 'b'").error.kind).toBe("type");
  });

  it("reports unknown names as reference errors, including prototype names", () => {
    expect(failure("missing").error).toMatchObject({ kind: "reference", position: 0, end: 7 });
    expect(failure("constructor").error.kind).toBe("reference");
    expect(failure("to_string + 1").error.kind).toBe("reference");
  });

  it("reads undefined env values as null", () => {
    expect(value("isnull(x)", { x: undefined })).toBe(true);
  });

  it("compares with null as false and rejects mixed or unordered types", () => {
    expect(value("x <= 3", { x: null })).toBe(false);
    expect(value("'a' >= x", { x: null })).toBe(false);
    expect(failure("xs < ys", { xs: [1], ys: [2] }).error.kind).toBe("type");
    expect(failure("'1' < 2").error.kind).toBe("type");
  });

  it("orders strings by code point", () => {
    // UTF-16 order would put U+1F600 (a surrogate pair) before U+FFFF.
    expect(value("a > b", { a: "😀", b: "￿" })).toBe(true);
    expect(value("'abc' < 'abcd'")).toBe(true);
    expect(value("'b' <= 'b'")).toBe(true);
  });

  it("equality never errors and is type-strict", () => {
    expect(value("0 == false")).toBe(false);
    expect(value("x == null", { x: "" })).toBe(false);
    expect(value("a == b", { a: [1, "x"], b: [1, "x"] })).toBe(true);
    expect(value("a == b", { a: [1, 2], b: [2, 1] })).toBe(false);
    expect(value("a != b", { a: [1], b: [1, 1] })).toBe(true);
    expect(value("a == 1", { a: [1] })).toBe(false);
    expect(valuesEqual(1, 1.0)).toBe(true);
    expect(valuesEqual([[1]], [[1]])).toBe(true);
  });

  it("returns null for non-finite results", () => {
    expect(value("x * x", { x: 1e200 })).toBeNull();
    expect(value("sum(x, x)", { x: 1e308 })).toBeNull();
    expect(value("exp(1000)")).toBeNull();
    expect(value("ln(-1)")).toBeNull();
    expect(value("log10(0)")).toBeNull();
    expect(value("0 ^ -1")).toBeNull();
  });

  it("keeps the sign of the dividend in %", () => {
    expect(value("-7.5 % 2")).toBe(-1.5);
    expect(value("7.5 % -2")).toBe(1.5);
  });

  it("never produces negative zero", () => {
    expect(Object.is(value("round(-0.4)"), 0)).toBe(true);
    expect(Object.is(value("-x", { x: 0 }), 0)).toBe(true);
    expect(Object.is(value("0 * -1"), 0)).toBe(true);
  });
});

describe("evaluate: logic and laziness", () => {
  it("short-circuits and/or and always yields a bool", () => {
    expect(value("x and y", { x: 1, y: true })).toBe(false);
    expect(value("true and 'yes'")).toBe(false);
    expect(value("false or 1")).toBe(false);
    expect(value("false or (true and 1)")).toBe(false);
    expect(value("x or y", { x: null, y: true })).toBe(true);
  });

  it("propagates errors from evaluated operands", () => {
    expect(failure("not ('a' + 1)").error.kind).toBe("type");
    expect(failure("if(1 + 'a', 1, 2)").error.kind).toBe("type");
    expect(failure("coalesce(x, missing)", { x: null }).error.kind).toBe("reference");
  });

  it("evaluates only the chosen if branch and coalesce up to the first non-null", () => {
    expect(value("if(false, missing, 2)")).toBe(2);
    expect(value("coalesce(x, 'a' + 1)", { x: false })).toBe(false);
    expect(value("coalesce(x, y)", { x: null, y: [] })).toEqual([]);
  });
});

describe("evaluate: functions", () => {
  it("aggregates flatten one level and skip nulls", () => {
    expect(value("sum(xs, ys, 1)", { xs: [1, null, 2], ys: null })).toBe(4);
    expect(value("avg(xs)", { xs: [] })).toBeNull();
    expect(value("min(xs, -1)", { xs: [3, -5] })).toBe(-5);
    expect(value("max(xs)", { xs: [null, null] })).toBeNull();
    expect(failure("sum(xs)", { xs: [[1]] }).error.kind).toBe("type");
    expect(failure("max(xs)", { xs: ["a"] }).error.kind).toBe("type");
  });

  it("count counts any non-null value after flattening", () => {
    expect(value("count(xs, true, 'a', null)", { xs: [[1], null, "b"] })).toBe(4);
    expect(value("count(x)", { x: null })).toBe(0);
  });

  it("round validates digits and rounds half away from zero", () => {
    expect(value("round(1.005, 2)")).toBe(1);
    expect(value("round(-1.25, 1)")).toBe(-1.3);
    expect(value("round(1234.5678, 10)")).toBe(1234.5678);
    expect(failure("round(1, 11)").error.kind).toBe("type");
    expect(failure("round(1, -1)").error.kind).toBe("type");
    expect(failure("round(1, true)").error.kind).toBe("type");
    expect(failure("round(1, x)", { x: null }).error.kind).toBe("type");
    expect(failure("round('1')").error.kind).toBe("type");
    expect(value("round(x, 1.5)", { x: null })).toBeNull();
    expect(roundHalfAwayFromZero(2.675, 2)).toBe(2.68);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
  });

  it("single-argument math functions pass null through and reject non-numbers", () => {
    for (const fn of ["floor", "ceil", "abs", "sqrt", "ln", "log10", "exp"]) {
      expect(value(`${fn}(x)`, { x: null })).toBeNull();
      expect(failure(`${fn}('1')`).error.kind).toBe("type");
    }
    expect(value("ceil(-1.5)")).toBe(-1);
  });

  it("pow behaves like ^", () => {
    expect(value("pow(x, 2)", { x: null })).toBeNull();
    expect(value("pow(-8, 1 / 3)")).toBeNull();
    expect(failure("pow('a', 2)").error.kind).toBe("type");
  });

  it("clamp treats null bounds as absent", () => {
    expect(value("clamp(5, lo, 3)", { lo: null })).toBe(3);
    expect(value("clamp(-5, 0, hi)", { hi: null })).toBe(0);
    expect(value("clamp(5, 0, 10)")).toBe(5);
    expect(failure("clamp('a', 0, 1)").error.kind).toBe("type");
    expect(failure("clamp(1, xs, 2)", { xs: [0] }).error.kind).toBe("type");
  });

  it("contains, isnull and len", () => {
    expect(value("contains(xs, x)", { xs: [[1, 2]], x: [1, 2] })).toBe(true);
    expect(value("contains(xs, null)", { xs: [null] })).toBe(true);
    expect(failure("contains(1, 1)").error.kind).toBe("type");
    expect(value("isnull(xs)", { xs: [] })).toBe(false);
    expect(value("len('😀é')")).toBe(2);
    expect(value("len(xs)", { xs: [] })).toBe(0);
    expect(failure("len(true)").error.kind).toBe("type");
  });

  it("rejects unknown functions and bad arity in hand-built ASTs", () => {
    const id = { type: "Identifier", name: "nope", start: 0, end: 4 } as const;
    const bad: Expr = { type: "CallExpression", callee: id, args: [], start: 0, end: 6 };
    expect(evaluate(bad, {})).toMatchObject({ ok: false, error: { kind: "function" } });
    const arity: Expr = { type: "CallExpression", callee: { ...id, name: "len" }, args: [], start: 0, end: 5 };
    expect(evaluate(arity, {})).toMatchObject({ ok: false, error: { kind: "function" } });
  });
});

describe("function names and reserved words", () => {
  it("lists every function and keyword", () => {
    expect([...FUNCTION_NAMES].sort()).toEqual(
      [
        "abs", "avg", "ceil", "clamp", "coalesce", "contains", "count", "exp", "floor", "if", "isnull",
        "len", "ln", "log10", "max", "mean", "min", "pow", "round", "sqrt", "sum",
      ].sort(),
    );
    for (const w of ["and", "or", "not", "true", "false", "null", "if", "sum"]) expect(RESERVED_WORDS).toContain(w);
    expect(isReservedWord("sleep")).toBe(false);
  });
});

describe("references", () => {
  it("returns variable names once, in order of first appearance", () => {
    expect(refs("b + a * b - sum(c, a)")).toEqual(["b", "a", "c"]);
  });

  it("excludes function names and literals but includes lazy branches", () => {
    expect(refs("if(x > 0, y, coalesce(z, 'w'))")).toEqual(["x", "y", "z"]);
    expect(refs("false and never or not other")).toEqual(["never", "other"]);
    expect(refs("round(1.5) + 'name'")).toEqual([]);
  });

  it("exposes identifier nodes with positions", () => {
    const r = parse("a + max(a, b)");
    if (!r.ok) throw new Error();
    expect(identifierNodes(r.ast).map((n) => [n.name, n.start, n.end])).toEqual([
      ["a", 0, 1],
      ["a", 8, 9],
      ["b", 11, 12],
    ]);
  });
});

describe("renameIdentifier", () => {
  it("rewrites only whole identifier references, preserving formatting", () => {
    expect(renameIdentifier("sleep +  sleep_hours*2 + sum( sleep ,1)", "sleep", "sleep_q")).toBe(
      "sleep_q +  sleep_hours*2 + sum( sleep_q ,1)",
    );
  });

  it("leaves strings, function names and other names alone", () => {
    expect(renameIdentifier("if(max == 'max', max, 1)", "max", "peak")).toBe("if(peak == 'max', peak, 1)");
    expect(renameIdentifier("max(a, 1)", "max", "peak")).toBe("max(a, 1)");
    expect(renameIdentifier("a + b", "c", "d")).toBe("a + b");
  });

  it("falls back to tokens for expressions that do not parse", () => {
    expect(renameIdentifier("a + (a", "a", "x")).toBe("x + (x");
    expect(renameIdentifier("a +", "a", "x")).toBe("x +");
  });

  it("returns the source unchanged when it cannot be tokenized", () => {
    expect(renameIdentifier("a + 'oops", "a", "x")).toBe("a + 'oops");
  });
});
