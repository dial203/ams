import { FUNCTION_ARITY, arityText } from "./functions";
import { SyntaxFailure, lex } from "./lexer";
import type { Token } from "./lexer";
import type {
  BinaryOperator,
  CallExpression,
  Expr,
  Identifier,
  ParseResult,
} from "./types";
import { hasOwn } from "../util";

const COMPARISON_OPERATORS = new Set(["==", "!=", "<", "<=", ">", ">="]);

function describe(token: Token, src: string): string {
  switch (token.type) {
    case "eof":
      return "end of expression";
    case "string":
      return `string ${src.slice(token.start, token.end)}`;
    case "number":
      return `number ${token.value}`;
    case "identifier":
      return `name '${token.value}'`;
    case "keyword":
      return `'${src.slice(token.start, token.end)}'`;
    default:
      return `'${token.value}'`;
  }
}

class Parser {
  private pos = 0;
  private readonly tokens: Token[];
  private readonly src: string;
  /** Outer spans of parenthesised sub-expressions, so parent spans include the parentheses. */
  private readonly outer = new WeakMap<Expr, { start: number; end: number }>();

  constructor(src: string) {
    this.src = src;
    this.tokens = lex(src);
  }

  parse(): Expr {
    if (this.peek().type === "eof") {
      throw new SyntaxFailure("Expression is empty", 0, this.src.length);
    }
    const expr = this.parseOr();
    const t = this.peek();
    if (t.type !== "eof") {
      if (t.type === "operator" && COMPARISON_OPERATORS.has(t.value)) {
        throw this.error(t, "Comparisons cannot be chained; combine them with 'and'");
      }
      throw this.error(t, `Unexpected ${describe(t, this.src)}`);
    }
    return expr;
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private next(): Token {
    const t = this.tokens[this.pos]!;
    if (t.type !== "eof") this.pos++;
    return t;
  }

  private error(t: Token, message: string): SyntaxFailure {
    return new SyntaxFailure(message, t.start, Math.max(t.end, t.start + 1));
  }

  private startOf(e: Expr): number {
    const o = this.outer.get(e);
    return o ? o.start : e.start;
  }

  private endOf(e: Expr): number {
    const o = this.outer.get(e);
    return o ? o.end : e.end;
  }

  private isKeyword(word: string): boolean {
    const t = this.peek();
    return t.type === "keyword" && t.value === word;
  }

  private isOperator(...ops: string[]): boolean {
    const t = this.peek();
    return t.type === "operator" && ops.indexOf(t.value) !== -1;
  }

  // or := and ( ("or" | "||") and )*
  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isKeyword("or")) {
      this.next();
      const right = this.parseAnd();
      left = { type: "LogicalExpression", operator: "or", left, right, start: this.startOf(left), end: this.endOf(right) };
    }
    return left;
  }

  // and := not ( ("and" | "&&") not )*
  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.isKeyword("and")) {
      this.next();
      const right = this.parseNot();
      left = { type: "LogicalExpression", operator: "and", left, right, start: this.startOf(left), end: this.endOf(right) };
    }
    return left;
  }

  // not := ("not" | "!") not | comparison
  private parseNot(): Expr {
    if (this.isKeyword("not")) {
      const t = this.next();
      const operand = this.parseNot();
      return { type: "UnaryExpression", operator: "not", operand, start: t.start, end: this.endOf(operand) };
    }
    return this.parseComparison();
  }

  // comparison := additive ( ("==" | "!=" | "<" | "<=" | ">" | ">=") additive )?
  private parseComparison(): Expr {
    const left = this.parseAdditive();
    const t = this.peek();
    if (t.type === "operator" && COMPARISON_OPERATORS.has(t.value)) {
      this.next();
      const right = this.parseAdditive();
      const after = this.peek();
      if (after.type === "operator" && COMPARISON_OPERATORS.has(after.value)) {
        throw this.error(after, "Comparisons cannot be chained; combine them with 'and'");
      }
      return {
        type: "BinaryExpression",
        operator: t.value as BinaryOperator,
        left,
        right,
        start: this.startOf(left),
        end: this.endOf(right),
      };
    }
    return left;
  }

  // additive := multiplicative ( ("+" | "-") multiplicative )*
  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.isOperator("+", "-")) {
      const op = this.next().value as BinaryOperator;
      const right = this.parseMultiplicative();
      left = { type: "BinaryExpression", operator: op, left, right, start: this.startOf(left), end: this.endOf(right) };
    }
    return left;
  }

  // multiplicative := unary ( ("*" | "/" | "%") unary )*
  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.isOperator("*", "/", "%")) {
      const op = this.next().value as BinaryOperator;
      const right = this.parseUnary();
      left = { type: "BinaryExpression", operator: op, left, right, start: this.startOf(left), end: this.endOf(right) };
    }
    return left;
  }

  // unary := "-" unary | power
  private parseUnary(): Expr {
    if (this.isOperator("-")) {
      const t = this.next();
      const operand = this.parseUnary();
      return { type: "UnaryExpression", operator: "-", operand, start: t.start, end: this.endOf(operand) };
    }
    return this.parsePower();
  }

  // power := primary ( "^" unary )?      (right-associative through unary -> power)
  private parsePower(): Expr {
    const base = this.parsePrimary();
    if (this.isOperator("^")) {
      this.next();
      const exponent = this.parseUnary();
      return { type: "BinaryExpression", operator: "^", left: base, right: exponent, start: this.startOf(base), end: this.endOf(exponent) };
    }
    return base;
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    switch (t.type) {
      case "number":
        this.next();
        return { type: "NumberLiteral", value: t.number!, raw: t.value, start: t.start, end: t.end };
      case "string":
        this.next();
        return { type: "StringLiteral", value: t.value, raw: this.src.slice(t.start, t.end), start: t.start, end: t.end };
      case "keyword":
        if (t.value === "true" || t.value === "false") {
          this.next();
          return { type: "BooleanLiteral", value: t.value === "true", start: t.start, end: t.end };
        }
        if (t.value === "null") {
          this.next();
          return { type: "NullLiteral", start: t.start, end: t.end };
        }
        throw this.error(t, `Unexpected ${describe(t, this.src)}`);
      case "identifier": {
        this.next();
        const id: Identifier = { type: "Identifier", name: t.value, start: t.start, end: t.end };
        if (this.peek().type === "lparen") return this.parseCall(id);
        return id;
      }
      case "lparen": {
        this.next();
        const inner = this.parseOr();
        const close = this.peek();
        if (close.type !== "rparen") {
          throw this.error(close, `Expected ')' but found ${describe(close, this.src)}`);
        }
        this.next();
        this.outer.set(inner, { start: t.start, end: close.end });
        return inner;
      }
      case "eof":
        throw this.error(t, "Unexpected end of expression");
      default:
        throw this.error(t, `Unexpected ${describe(t, this.src)}`);
    }
  }

  private parseCall(callee: Identifier): CallExpression {
    if (!hasOwn(FUNCTION_ARITY, callee.name)) {
      throw new SyntaxFailure(`Unknown function '${callee.name}'`, callee.start, callee.end);
    }
    this.next(); // "("
    const args: Expr[] = [];
    if (this.peek().type !== "rparen") {
      args.push(this.parseOr());
      while (this.peek().type === "comma") {
        this.next();
        args.push(this.parseOr());
      }
    }
    const close = this.peek();
    if (close.type !== "rparen") {
      throw this.error(close, `Expected ',' or ')' but found ${describe(close, this.src)}`);
    }
    this.next();
    const arity = FUNCTION_ARITY[callee.name]!;
    if (args.length < arity.min || args.length > arity.max) {
      throw new SyntaxFailure(
        `${callee.name}() takes ${arityText(arity)}, got ${args.length}`,
        callee.start,
        close.end,
      );
    }
    return { type: "CallExpression", callee, args, start: callee.start, end: close.end };
  }
}

/**
 * Parses an expression. Unknown functions and wrong argument counts are parse errors
 * (static checks), as are chained comparisons.
 */
export function parse(src: string): ParseResult {
  try {
    return { ok: true, ast: new Parser(src).parse() };
  } catch (e) {
    if (e instanceof SyntaxFailure) return { ok: false, error: e.error };
    throw e;
  }
}
