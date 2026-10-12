import { FUNCTION_ARITY, arityText } from "./functions";
import { parse } from "./parser";
import type {
  CallExpression,
  EvaluationError,
  EvaluationErrorKind,
  EvaluationResult,
  Expr,
  ExpressionResult,
  Span,
  Value,
} from "./types";
import { codePointLength, compareCodePoints, hasOwn } from "../util";

/** Thrown internally; converted to an `EvaluationError` result at the API boundary. */
class EvaluationFailure {
  readonly error: EvaluationError;
  constructor(kind: EvaluationErrorKind, message: string, at: Span) {
    this.error = { kind, message, position: at.start, end: at.end };
  }
}

export type ValueType = "null" | "number" | "string" | "boolean" | "list" | "other";

/** The language-level type of a runtime value. `undefined` counts as `null`. */
export function typeOf(v: unknown): ValueType {
  if (v === null || v === undefined) return "null";
  switch (typeof v) {
    case "number":
      return "number";
    case "string":
      return "string";
    case "boolean":
      return "boolean";
  }
  return Array.isArray(v) ? "list" : "other";
}

function describeType(v: unknown): string {
  const t = typeOf(v);
  return t === "boolean" ? "bool" : t;
}

/** Non-finite results become `null`; `-0` is normalised to `0`. */
function num(x: number): number | null {
  if (!isFinite(x)) return null;
  return x === 0 ? 0 : x;
}

/**
 * `==` of the language: never errors. Equal when same type and same value; numbers by
 * value; lists when same length and pairwise equal.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  const ta = typeOf(a);
  if (ta !== typeOf(b)) return false;
  switch (ta) {
    case "null":
      return true;
    case "list": {
      const la = a as unknown[];
      const lb = b as unknown[];
      if (la.length !== lb.length) return false;
      for (let i = 0; i < la.length; i++) if (!valuesEqual(la[i], lb[i])) return false;
      return true;
    }
    default:
      return a === b;
  }
}

/** `sign(x) * floor(abs(x) * 10^d + 0.5) / 10^d` in doubles (half away from zero). */
export function roundHalfAwayFromZero(x: number, d = 0): number {
  const p = Math.pow(10, d);
  const r = (Math.sign(x) * Math.floor(Math.abs(x) * p + 0.5)) / p;
  return r === 0 ? 0 : r;
}

const MATH_1: Record<string, (x: number) => number> = {
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
  sqrt: Math.sqrt,
  ln: Math.log,
  log10: Math.log10,
  exp: Math.exp,
};

class Evaluator {
  private readonly env: Readonly<Record<string, unknown>>;

  constructor(env: Readonly<Record<string, unknown>>) {
    this.env = env;
  }

  private typeError(at: Span, message: string): EvaluationFailure {
    return new EvaluationFailure("type", message, at);
  }

  eval(node: Expr): Value {
    switch (node.type) {
      case "NumberLiteral":
        return num(node.value);
      case "StringLiteral":
        return node.value;
      case "BooleanLiteral":
        return node.value;
      case "NullLiteral":
        return null;
      case "Identifier": {
        if (!hasOwn(this.env, node.name)) {
          throw new EvaluationFailure("reference", `Unknown name '${node.name}'`, node);
        }
        const v = this.env[node.name];
        return v === undefined ? null : (v as Value);
      }
      case "UnaryExpression": {
        const v = this.eval(node.operand);
        if (node.operator === "not") return v !== true;
        const t = typeOf(v);
        if (t === "null") return null;
        if (t === "number") return num(-(v as number));
        throw this.typeError(node, `Cannot negate a ${describeType(v)}`);
      }
      case "LogicalExpression": {
        const left = this.eval(node.left);
        if (node.operator === "and") {
          if (left !== true) return false;
          return this.eval(node.right) === true;
        }
        if (left === true) return true;
        return this.eval(node.right) === true;
      }
      case "BinaryExpression": {
        const a = this.eval(node.left);
        const b = this.eval(node.right);
        switch (node.operator) {
          case "==":
            return valuesEqual(a, b);
          case "!=":
            return !valuesEqual(a, b);
          case "<":
          case "<=":
          case ">":
          case ">=":
            return this.compare(node.operator, a, b, node);
          default:
            return this.arithmetic(node.operator, a, b, node);
        }
      }
      case "CallExpression":
        return this.call(node);
    }
  }

  private compare(op: "<" | "<=" | ">" | ">=", a: Value, b: Value, at: Span): boolean {
    const ta = typeOf(a);
    const tb = typeOf(b);
    if (ta === "null" || tb === "null") return false;
    let c: number;
    if (ta === "number" && tb === "number") {
      c = (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
    } else if (ta === "string" && tb === "string") {
      c = compareCodePoints(a as string, b as string);
    } else {
      throw this.typeError(at, `Cannot compare ${describeType(a)} ${op} ${describeType(b)}`);
    }
    switch (op) {
      case "<":
        return c < 0;
      case "<=":
        return c <= 0;
      case ">":
        return c > 0;
      case ">=":
        return c >= 0;
    }
  }

  arithmetic(op: string, a: Value, b: Value, at: Span): Value {
    const ta = typeOf(a);
    const tb = typeOf(b);
    if (ta === "null" || tb === "null") return null;
    if (ta === "number" && tb === "number") {
      const x = a as number;
      const y = b as number;
      switch (op) {
        case "+":
          return num(x + y);
        case "-":
          return num(x - y);
        case "*":
          return num(x * y);
        case "/":
          return y === 0 ? null : num(x / y);
        case "%":
          // JS `%` keeps the sign of the dividend, as the spec requires.
          return y === 0 ? null : num(x % y);
        case "^":
          return num(Math.pow(x, y));
      }
    }
    if (op === "+" && ta === "string" && tb === "string") return (a as string) + (b as string);
    throw this.typeError(at, `Cannot apply '${op}' to ${describeType(a)} and ${describeType(b)}`);
  }

  /** Flattens list arguments one level and drops nulls. */
  private flatten(values: Value[]): unknown[] {
    const out: unknown[] = [];
    for (const v of values) {
      if (Array.isArray(v)) {
        for (const item of v) if (typeOf(item) !== "null") out.push(item);
      } else if (typeOf(v) !== "null") {
        out.push(v);
      }
    }
    return out;
  }

  private numbers(name: string, values: Value[], at: Span): number[] {
    const items = this.flatten(values);
    for (const item of items) {
      if (typeOf(item) !== "number") {
        throw this.typeError(at, `${name}() expects numbers, got ${describeType(item)}`);
      }
    }
    return items as number[];
  }

  private numberArg(name: string, v: Value, at: Span): number | null {
    const t = typeOf(v);
    if (t === "null") return null;
    if (t !== "number") throw this.typeError(at, `${name}() expects a number, got ${describeType(v)}`);
    return v as number;
  }

  private call(node: CallExpression): Value {
    const name = node.callee.name;
    const arity = hasOwn(FUNCTION_ARITY, name) ? FUNCTION_ARITY[name] : undefined;
    if (!arity) throw new EvaluationFailure("function", `Unknown function '${name}'`, node.callee);
    const argc = node.args.length;
    if (argc < arity.min || argc > arity.max) {
      throw new EvaluationFailure("function", `${name}() takes ${arityText(arity)}, got ${argc}`, node);
    }

    // Lazy functions first: only the needed arguments are evaluated.
    if (name === "if") {
      return this.eval(node.args[0]!) === true ? this.eval(node.args[1]!) : this.eval(node.args[2]!);
    }
    if (name === "coalesce") {
      for (const arg of node.args) {
        const v = this.eval(arg);
        if (v !== null) return v;
      }
      return null;
    }

    const args = node.args.map((a) => this.eval(a));
    switch (name) {
      case "sum":
      case "avg":
      case "mean": {
        const xs = this.numbers(name, args, node);
        if (xs.length === 0) return null;
        let total = 0;
        for (const x of xs) total += x;
        return num(name === "sum" ? total : total / xs.length);
      }
      case "min":
      case "max": {
        const xs = this.numbers(name, args, node);
        if (xs.length === 0) return null;
        let m = xs[0]!;
        for (const x of xs) if (name === "min" ? x < m : x > m) m = x;
        return num(m);
      }
      case "count":
        return this.flatten(args).length;
      case "round": {
        const x = this.numberArg(name, args[0]!, node);
        if (x === null) return null;
        let d = 0;
        if (argc === 2) {
          const dv = args[1];
          if (typeof dv !== "number" || !Number.isInteger(dv) || dv < 0 || dv > 10) {
            throw this.typeError(node, "round() digits must be an integer from 0 to 10");
          }
          d = dv;
        }
        return num(roundHalfAwayFromZero(x, d));
      }
      case "floor":
      case "ceil":
      case "abs":
      case "sqrt":
      case "ln":
      case "log10":
      case "exp": {
        const x = this.numberArg(name, args[0]!, node);
        if (x === null) return null;
        return num(MATH_1[name]!(x));
      }
      case "pow":
        return this.arithmetic("^", args[0]!, args[1]!, node);
      case "clamp": {
        const x = this.numberArg(name, args[0]!, node);
        const lo = this.numberArg(name, args[1]!, node);
        const hi = this.numberArg(name, args[2]!, node);
        if (x === null) return null;
        // min(max(x, lo), hi) where min/max skip nulls.
        let r = x;
        if (lo !== null && lo > r) r = lo;
        if (hi !== null && hi < r) r = hi;
        return num(r);
      }
      case "isnull":
        return args[0] === null;
      case "contains": {
        const list = args[0]!;
        const t = typeOf(list);
        if (t === "null") return false;
        if (t !== "list") throw this.typeError(node, `contains() expects a list, got ${describeType(list)}`);
        const needle = args[1];
        for (const item of list as Value[]) if (valuesEqual(item, needle)) return true;
        return false;
      }
      case "len": {
        const v = args[0]!;
        const t = typeOf(v);
        if (t === "null") return 0;
        if (t === "string") return codePointLength(v as string);
        if (t === "list") return (v as Value[]).length;
        throw this.typeError(node, `len() expects a string or list, got ${describeType(v)}`);
      }
    }
    /* c8 ignore next */
    throw new EvaluationFailure("function", `Unknown function '${name}'`, node.callee);
  }
}

/**
 * Evaluates a parsed expression against `env`. Never throws for language-level
 * problems: type errors and unknown names come back as `{ ok: false }`.
 *
 * `env` values are used as given (`undefined` reads as `null`). Form evaluation
 * normalises `""` and `[]` to `null` before building the env.
 */
export function evaluate(ast: Expr, env: Readonly<Record<string, Value>> | Readonly<Record<string, unknown>>): EvaluationResult {
  try {
    return { ok: true, value: new Evaluator(env).eval(ast) };
  } catch (e) {
    if (e instanceof EvaluationFailure) return { ok: false, error: e.error };
    throw e;
  }
}

/** Parses and evaluates in one go. */
export function evaluateExpression(
  src: string,
  env: Readonly<Record<string, Value>> | Readonly<Record<string, unknown>> = {},
): ExpressionResult {
  const parsed = parse(src);
  if (!parsed.ok) return { ok: false, stage: "parse", error: parsed.error };
  const result = evaluate(parsed.ast, env);
  if (!result.ok) return { ok: false, stage: "evaluate", error: result.error };
  return result;
}
