import { tokenize } from "./lexer";
import { parse } from "./parser";
import type { Expr, Identifier, Span } from "./types";

/** Calls `visit` for every node, parents before children, left to right. */
export function walk(ast: Expr, visit: (node: Expr) => void): void {
  visit(ast);
  switch (ast.type) {
    case "UnaryExpression":
      walk(ast.operand, visit);
      break;
    case "BinaryExpression":
    case "LogicalExpression":
      walk(ast.left, visit);
      walk(ast.right, visit);
      break;
    case "CallExpression":
      // The callee is a function name, not a variable reference.
      for (const arg of ast.args) walk(arg, visit);
      break;
    default:
      break;
  }
}

/** Every identifier node that refers to a variable (field), in source order. */
export function identifierNodes(ast: Expr): Identifier[] {
  const out: Identifier[] = [];
  walk(ast, (node) => {
    if (node.type === "Identifier") out.push(node);
  });
  return out;
}

/**
 * Names of the variables (field keys) an expression refers to, unique, in order of
 * first appearance. Includes names inside lazy branches (`if`, `coalesce`, `and`/`or`).
 */
export function references(ast: Expr): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of identifierNodes(ast)) {
    if (!seen.has(id.name)) {
      seen.add(id.name);
      out.push(id.name);
    }
  }
  return out;
}

function spliceSpans(src: string, spans: Span[], replacement: string): string {
  if (spans.length === 0) return src;
  const sorted = spans.slice().sort((a, b) => a.start - b.start);
  let out = "";
  let last = 0;
  for (const s of sorted) {
    out += src.slice(last, s.start) + replacement;
    last = s.end;
  }
  return out + src.slice(last);
}

/**
 * Rewrites every reference to `oldName` in an expression source string to `newName`,
 * using source positions, so formatting, strings and function names are untouched.
 *
 * If the expression does not parse, identifier tokens are renamed when the source can
 * at least be tokenized (an identifier directly followed by `(` is a function call and
 * is left alone). Otherwise the source is returned unchanged.
 */
export function renameIdentifier(src: string, oldName: string, newName: string): string {
  if (oldName === newName) return src;
  const parsed = parse(src);
  if (parsed.ok) {
    return spliceSpans(
      src,
      identifierNodes(parsed.ast).filter((id) => id.name === oldName),
      newName,
    );
  }
  const lexed = tokenize(src);
  if (!lexed.ok) return src;
  const spans: Span[] = [];
  const tokens = lexed.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === "identifier" && t.value === oldName && tokens[i + 1]?.type !== "lparen") {
      spans.push(t);
    }
  }
  return spliceSpans(src, spans, newName);
}
