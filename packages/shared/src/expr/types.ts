/**
 * Values of the expression language (docs/FORMS.md "Values").
 * Lists only come from `multiselect` values; there is no list literal.
 */
export type Value = number | string | boolean | null | Value[];

/** Variables available to an expression: field key -> current value. */
export type Env = Record<string, Value>;

/** Half-open source range `[start, end)` in UTF-16 code units of the expression string. */
export interface Span {
  start: number;
  end: number;
}

export type ArithmeticOperator = "+" | "-" | "*" | "/" | "%" | "^";
export type EqualityOperator = "==" | "!=";
export type ComparisonOperator = "<" | "<=" | ">" | ">=";
export type BinaryOperator = ArithmeticOperator | EqualityOperator | ComparisonOperator;
export type LogicalOperator = "and" | "or";
export type UnaryOperator = "-" | "not";

export interface NumberLiteral extends Span {
  type: "NumberLiteral";
  value: number;
  raw: string;
}

export interface StringLiteral extends Span {
  type: "StringLiteral";
  value: string;
  raw: string;
}

export interface BooleanLiteral extends Span {
  type: "BooleanLiteral";
  value: boolean;
}

export interface NullLiteral extends Span {
  type: "NullLiteral";
}

export interface Identifier extends Span {
  type: "Identifier";
  name: string;
}

export interface UnaryExpression extends Span {
  type: "UnaryExpression";
  /** `"not"` also covers `!`. */
  operator: UnaryOperator;
  operand: Expr;
}

export interface BinaryExpression extends Span {
  type: "BinaryExpression";
  operator: BinaryOperator;
  left: Expr;
  right: Expr;
}

export interface LogicalExpression extends Span {
  type: "LogicalExpression";
  /** `"and"` also covers `&&`, `"or"` covers `||`. */
  operator: LogicalOperator;
  left: Expr;
  right: Expr;
}

export interface CallExpression extends Span {
  type: "CallExpression";
  callee: Identifier;
  args: Expr[];
}

/** Expression AST. Every node carries its source span. */
export type Expr =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | NullLiteral
  | Identifier
  | UnaryExpression
  | BinaryExpression
  | LogicalExpression
  | CallExpression;

export interface ParseError {
  message: string;
  /** Offset (UTF-16 code units) where the problem starts. */
  position: number;
  /** Offset just past the offending text, when known. */
  end: number;
}

export type ParseResult = { ok: true; ast: Expr } | { ok: false; error: ParseError };

/**
 * - `type`: an operand has a type the operation does not accept (`'a' + 1`).
 * - `reference`: unknown identifier.
 * - `function`: unknown function or wrong argument count (only reachable for
 *   hand-built ASTs; the parser rejects these statically).
 */
export type EvaluationErrorKind = "type" | "reference" | "function";

export interface EvaluationError {
  kind: EvaluationErrorKind;
  message: string;
  /** Offset of the node that failed. */
  position: number;
  end: number;
}

export type EvaluationResult = { ok: true; value: Value } | { ok: false; error: EvaluationError };

/** Result of `evaluateExpression`, which parses then evaluates. */
export type ExpressionResult =
  | { ok: true; value: Value }
  | { ok: false; stage: "parse"; error: ParseError }
  | { ok: false; stage: "evaluate"; error: EvaluationError };
