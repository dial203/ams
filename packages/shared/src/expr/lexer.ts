import type { ParseError } from "./types";

export type TokenType =
  | "number"
  | "string"
  | "identifier"
  | "keyword"
  | "operator"
  | "lparen"
  | "rparen"
  | "comma"
  | "eof";

export interface Token {
  type: TokenType;
  /**
   * Source text for numbers, identifiers, keywords and punctuation; operators are
   * normalised (`&&` -> `and`, `||` -> `or`, `!` -> `not`), the raw text is `src.slice(start, end)`.
   * For strings: the decoded value.
   */
  value: string;
  /** Numeric value for `number` tokens. */
  number?: number;
  start: number;
  end: number;
}

export type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; error: ParseError };

/** Thrown internally; converted to a `ParseError` result at the API boundary. */
export class SyntaxFailure {
  readonly error: ParseError;
  constructor(message: string, position: number, end: number = position + 1) {
    this.error = { message, position, end };
  }
}

const KEYWORDS = new Set(["and", "or", "not", "true", "false", "null"]);

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

function isIdentStart(c: string | undefined): boolean {
  return c !== undefined && ((c >= "a" && c <= "z") || c === "_");
}

function isIdentPart(c: string | undefined): boolean {
  return isIdentStart(c) || isDigit(c);
}

function isWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
}

const ESCAPES: Record<string, string> = { '"': '"', "'": "'", "\\": "\\", n: "\n", t: "\t" };

function describeChar(c: string): string {
  if (c === "'") return `"'"`;
  return `'${c}'`;
}

/** Splits an expression into tokens. Throws `SyntaxFailure`. */
export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i]!;
    if (isWhitespace(c)) {
      i++;
      continue;
    }
    const start = i;

    // number := ( digits [ "." digits ] | "." digits ) [ ("e"|"E") ["+"|"-"] digits ]
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      while (isDigit(src[i])) i++;
      if (src[i] === ".") {
        if (!isDigit(src[i + 1])) {
          throw new SyntaxFailure("Expected a digit after '.' in number", i, i + 1);
        }
        i++;
        while (isDigit(src[i])) i++;
      }
      if (src[i] === "e" || src[i] === "E") {
        let j = i + 1;
        if (src[j] === "+" || src[j] === "-") j++;
        if (!isDigit(src[j])) {
          throw new SyntaxFailure("Expected digits in number exponent", i, j);
        }
        while (isDigit(src[j])) j++;
        i = j;
      }
      const raw = src.slice(start, i);
      tokens.push({ type: "number", value: raw, number: Number(raw), start, end: i });
      continue;
    }

    if (isIdentStart(c)) {
      while (isIdentPart(src[i])) i++;
      const word = src.slice(start, i);
      tokens.push({ type: KEYWORDS.has(word) ? "keyword" : "identifier", value: word, start, end: i });
      continue;
    }

    if (c === '"' || c === "'") {
      i++;
      let value = "";
      let closed = false;
      while (i < n) {
        const d = src[i]!;
        if (d === c) {
          closed = true;
          i++;
          break;
        }
        if (d === "\\") {
          const e = src[i + 1];
          if (e === undefined) break;
          const mapped = ESCAPES[e];
          if (mapped === undefined) {
            throw new SyntaxFailure(`Invalid escape sequence '\\${e}' in string`, i, i + 2);
          }
          value += mapped;
          i += 2;
          continue;
        }
        value += d;
        i++;
      }
      if (!closed) throw new SyntaxFailure("Unterminated string", start, n);
      tokens.push({ type: "string", value, start, end: i });
      continue;
    }

    const next = src[i + 1];
    const two = c + (next ?? "");
    switch (two) {
      case "==":
      case "!=":
      case "<=":
      case ">=":
        tokens.push({ type: "operator", value: two, start, end: i + 2 });
        i += 2;
        continue;
      case "&&":
        tokens.push({ type: "keyword", value: "and", start, end: i + 2 });
        i += 2;
        continue;
      case "||":
        tokens.push({ type: "keyword", value: "or", start, end: i + 2 });
        i += 2;
        continue;
    }

    switch (c) {
      case "+":
      case "-":
      case "*":
      case "/":
      case "%":
      case "^":
      case "<":
      case ">":
        tokens.push({ type: "operator", value: c, start, end: i + 1 });
        i++;
        continue;
      case "!":
        tokens.push({ type: "keyword", value: "not", start, end: i + 1 });
        i++;
        continue;
      case "(":
        tokens.push({ type: "lparen", value: c, start, end: i + 1 });
        i++;
        continue;
      case ")":
        tokens.push({ type: "rparen", value: c, start, end: i + 1 });
        i++;
        continue;
      case ",":
        tokens.push({ type: "comma", value: c, start, end: i + 1 });
        i++;
        continue;
      case "=":
        throw new SyntaxFailure("Unexpected '='; use '==' to compare", i, i + 1);
      case "&":
        throw new SyntaxFailure("Unexpected '&'; use 'and' or '&&'", i, i + 1);
      case "|":
        throw new SyntaxFailure("Unexpected '|'; use 'or' or '||'", i, i + 1);
    }

    if (c >= "A" && c <= "Z") {
      let j = i;
      while (j < n && (isIdentPart(src[j]) || (src[j]! >= "A" && src[j]! <= "Z"))) j++;
      throw new SyntaxFailure(
        `Unexpected '${src.slice(i, j)}': names are lowercase (letters, digits and '_')`,
        i,
        j,
      );
    }
    const cp = src.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    throw new SyntaxFailure(`Unexpected character ${describeChar(ch)}`, i, i + ch.length);
  }

  tokens.push({ type: "eof", value: "", start: n, end: n });
  return tokens;
}

/** Tokenizes without throwing. */
export function tokenize(src: string): TokenizeResult {
  try {
    return { ok: true, tokens: lex(src) };
  } catch (e) {
    if (e instanceof SyntaxFailure) return { ok: false, error: e.error };
    throw e;
  }
}
