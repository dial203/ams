import { describe, expect, it } from "vitest";
import { parse, tokenize } from "../src/expr";
import type { Expr } from "../src/expr";

function tokens(src: string) {
  const r = tokenize(src);
  if (!r.ok) throw new Error(r.error.message);
  return r.tokens.map((t) => [t.type, t.value, t.start, t.end]);
}

function lexError(src: string) {
  const r = tokenize(src);
  if (r.ok) throw new Error(`expected a lex error for ${src}`);
  return r.error;
}

function ast(src: string): Expr {
  const r = parse(src);
  if (!r.ok) throw new Error(`${r.error.message} at ${r.error.position}`);
  return r.ast;
}

function parseError(src: string) {
  const r = parse(src);
  if (r.ok) throw new Error(`expected a parse error for ${src}`);
  return r.error;
}

/** Compact s-expression rendering of an AST, for shape assertions. */
function sexpr(e: Expr): string {
  switch (e.type) {
    case "NumberLiteral":
      return String(e.value);
    case "StringLiteral":
      return JSON.stringify(e.value);
    case "BooleanLiteral":
      return String(e.value);
    case "NullLiteral":
      return "null";
    case "Identifier":
      return e.name;
    case "UnaryExpression":
      return `(${e.operator} ${sexpr(e.operand)})`;
    case "BinaryExpression":
    case "LogicalExpression":
      return `(${e.operator} ${sexpr(e.left)} ${sexpr(e.right)})`;
    case "CallExpression":
      return `(${e.callee.name}${e.args.map((a) => ` ${sexpr(a)}`).join("")})`;
  }
}

describe("lexer", () => {
  it("tokenizes numbers in every allowed form", () => {
    expect(tokens("1 2.50 .5 1e3 2.5E-1 7e+2")).toEqual([
      ["number", "1", 0, 1],
      ["number", "2.50", 2, 6],
      ["number", ".5", 7, 9],
      ["number", "1e3", 10, 13],
      ["number", "2.5E-1", 14, 20],
      ["number", "7e+2", 21, 25],
      ["eof", "", 25, 25],
    ]);
    const r = tokenize("2.5E-1");
    expect(r.ok && r.tokens[0]!.number).toBe(0.25);
  });

  it("rejects malformed numbers", () => {
    expect(lexError("5.")).toMatchObject({ position: 1 });
    expect(lexError("5.e3").position).toBe(1);
    expect(lexError("1e").message).toMatch(/exponent/);
    expect(lexError("1e+").position).toBe(1);
    expect(lexError("a.b")).toMatchObject({ position: 1, end: 2 });
  });

  it("decodes string escapes and both quote styles", () => {
    const r = tokenize(`'it\\'s' "a\\\\b" 'tab\\there' "nl\\n" "say \\"hi\\""`);
    expect(r.ok && r.tokens.slice(0, 5).map((t) => t.value)).toEqual(["it's", "a\\b", "tab\there", "nl\n", 'say "hi"']);
    expect(tokenize(`"it's"`).ok && tokens(`"it's"`)[0]).toEqual(["string", "it's", 0, 6]);
  });

  it("rejects unknown escapes and unterminated strings", () => {
    expect(lexError(`'a\\x'`)).toMatchObject({ position: 2, end: 4 });
    expect(lexError(`'abc`)).toMatchObject({ position: 0, end: 4, message: "Unterminated string" });
    expect(lexError(`'abc\\`).message).toBe("Unterminated string");
  });

  it("normalises && || ! to keywords and keeps two-char operators together", () => {
    expect(tokens("a&&b||!c != d <= e >= f == g")).toEqual([
      ["identifier", "a", 0, 1],
      ["keyword", "and", 1, 3],
      ["identifier", "b", 3, 4],
      ["keyword", "or", 4, 6],
      ["keyword", "not", 6, 7],
      ["identifier", "c", 7, 8],
      ["operator", "!=", 9, 11],
      ["identifier", "d", 12, 13],
      ["operator", "<=", 14, 16],
      ["identifier", "e", 17, 18],
      ["operator", ">=", 19, 21],
      ["identifier", "f", 22, 23],
      ["operator", "==", 24, 26],
      ["identifier", "g", 27, 28],
      ["eof", "", 28, 28],
    ]);
  });

  it("recognises keywords only as whole words", () => {
    expect(tokens("android or_x nottrue null")).toEqual([
      ["identifier", "android", 0, 7],
      ["identifier", "or_x", 8, 12],
      ["identifier", "nottrue", 13, 20],
      ["keyword", "null", 21, 25],
      ["eof", "", 25, 25],
    ]);
  });

  it("rejects stray characters with their position", () => {
    expect(lexError("a = 1")).toMatchObject({ position: 2, message: expect.stringMatching(/==/) });
    expect(lexError("a & b").position).toBe(2);
    expect(lexError("a | b").position).toBe(2);
    expect(lexError("x # y")).toMatchObject({ position: 2, end: 3 });
    expect(lexError("Abc")).toMatchObject({ position: 0, end: 3 });
    expect(lexError("sleepQuality")).toMatchObject({ position: 5, end: 12 });
    // A character outside the BMP is reported whole.
    expect(lexError("1 + 😀")).toMatchObject({ position: 4, end: 6, message: "Unexpected character '😀'" });
  });

  it("treats tabs and newlines as whitespace", () => {
    expect(tokens("\t1\n+\r\n2 ")).toEqual([
      ["number", "1", 1, 2],
      ["operator", "+", 3, 4],
      ["number", "2", 6, 7],
      ["eof", "", 8, 8],
    ]);
  });
});

describe("parser: precedence and associativity", () => {
  it.each([
    ["1 + 2 * 3", "(+ 1 (* 2 3))"],
    ["10 - 4 - 3", "(- (- 10 4) 3)"],
    ["2 ^ 3 ^ 2", "(^ 2 (^ 3 2))"],
    ["-2 ^ 2", "(- (^ 2 2))"],
    ["2 ^ -1", "(^ 2 (- 1))"],
    ["--3", "(- (- 3))"],
    ["-7 % 3", "(% (- 7) 3)"],
    ["not a == b", "(not (== a b))"],
    ["!a && b", "(and (not a) b)"],
    ["a or b and c", "(or a (and b c))"],
    ["a and b or c and d", "(or (and a b) (and c d))"],
    ["not not x", "(not (not x))"],
    ["a + b > c * 2", "(> (+ a b) (* c 2))"],
    ["if(x > 5, 'hi', \"lo\")", '(if (> x 5) "hi" "lo")'],
    ["sum ( 1 , 2 )", "(sum 1 2)"],
    ["((1))", "1"],
  ])("%s", (src, expected) => {
    expect(sexpr(ast(src))).toBe(expected);
  });
});

describe("parser: source positions", () => {
  it("records spans for every node", () => {
    const e = ast("round(rpe * duration, 1)");
    expect(e).toMatchObject({ type: "CallExpression", start: 0, end: 24 });
    if (e.type !== "CallExpression") throw new Error();
    expect(e.callee).toEqual({ type: "Identifier", name: "round", start: 0, end: 5 });
    expect(e.args[0]).toMatchObject({ type: "BinaryExpression", operator: "*", start: 6, end: 20 });
    expect(e.args[1]).toMatchObject({ type: "NumberLiteral", value: 1, raw: "1", start: 22, end: 23 });
  });

  it("includes parentheses in composite spans but not in the inner node", () => {
    const e = ast("(a + b) * c");
    expect(e).toMatchObject({ type: "BinaryExpression", start: 0, end: 11 });
    if (e.type !== "BinaryExpression") throw new Error();
    expect(e.left).toMatchObject({ type: "BinaryExpression", start: 1, end: 6 });
    if (e.left.type !== "BinaryExpression") throw new Error();
    expect(e.left.left).toEqual({ type: "Identifier", name: "a", start: 1, end: 2 });
  });

  it("spans unary and logical nodes from the operator", () => {
    const e = ast("  not x || -y");
    expect(e).toMatchObject({ type: "LogicalExpression", operator: "or", start: 2, end: 13 });
    if (e.type !== "LogicalExpression") throw new Error();
    expect(e.left).toMatchObject({ type: "UnaryExpression", operator: "not", start: 2, end: 7 });
    expect(e.right).toMatchObject({ type: "UnaryExpression", operator: "-", start: 11, end: 13 });
  });

  it("keeps the raw text of string literals", () => {
    expect(ast(`'it\\'s'`)).toMatchObject({ type: "StringLiteral", value: "it's", raw: `'it\\'s'`, start: 0, end: 7 });
  });
});

describe("parser: errors", () => {
  it("reports empty input", () => {
    expect(parseError("")).toMatchObject({ message: "Expression is empty", position: 0 });
    expect(parseError("   ").message).toBe("Expression is empty");
  });

  it("points at the offending token", () => {
    expect(parseError("1 +")).toMatchObject({ position: 3, message: "Unexpected end of expression" });
    expect(parseError("(1 + 2")).toMatchObject({ position: 6, message: expect.stringMatching(/Expected '\)'/) });
    expect(parseError("1 2")).toMatchObject({ position: 2, end: 3, message: "Unexpected number 2" });
    expect(parseError("a b")).toMatchObject({ position: 2, message: "Unexpected name 'b'" });
    expect(parseError("1 + )")).toMatchObject({ position: 4 });
    expect(parseError("a == not b")).toMatchObject({ position: 5, message: "Unexpected 'not'" });
    expect(parseError("sum(1,)")).toMatchObject({ position: 6 });
    expect(parseError("sum(1 2)")).toMatchObject({ position: 6, message: expect.stringMatching(/Expected ',' or '\)'/) });
  });

  it("rejects chained comparisons", () => {
    expect(parseError("1 < 2 < 3")).toMatchObject({ position: 6, message: expect.stringMatching(/chained/) });
    expect(parseError("a == b == c").position).toBe(7);
  });

  it("rejects unknown functions and wrong arity statically", () => {
    expect(parseError("1 + unknown_fn(1)")).toMatchObject({ position: 4, end: 14, message: "Unknown function 'unknown_fn'" });
    expect(parseError("round(1, 2, 3)")).toMatchObject({
      position: 0,
      end: 14,
      message: "round() takes 1 to 2 arguments, got 3",
    });
    expect(parseError("sum()").message).toBe("sum() takes at least 1 argument, got 0");
    expect(parseError("if(true, 1)").message).toBe("if() takes 3 arguments, got 2");
    expect(parseError("len()").message).toBe("len() takes 1 argument, got 0");
    // Keywords are not functions: `not(1)` is `not (1)`, `and(1)` is an error.
    expect(sexpr(ast("not(1)"))).toBe("(not 1)");
    expect(parseError("and(1)")).toMatchObject({ position: 0, message: "Unexpected 'and'" });
  });

  it("allows a function name as a plain identifier (it is reserved, so it never resolves)", () => {
    expect(ast("sum")).toMatchObject({ type: "Identifier", name: "sum" });
  });
});
