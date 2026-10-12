/** Function table and reserved words (docs/FORMS.md "Functions"). */

export interface Arity {
  min: number;
  /** `Infinity` for variadic functions. */
  max: number;
}

const VARIADIC: Arity = { min: 1, max: Infinity };
const ONE: Arity = { min: 1, max: 1 };

export const FUNCTION_ARITY: Readonly<Record<string, Arity>> = Object.freeze({
  sum: VARIADIC,
  avg: VARIADIC,
  mean: VARIADIC,
  min: VARIADIC,
  max: VARIADIC,
  count: VARIADIC,
  round: { min: 1, max: 2 },
  floor: ONE,
  ceil: ONE,
  abs: ONE,
  sqrt: ONE,
  ln: ONE,
  log10: ONE,
  exp: ONE,
  pow: { min: 2, max: 2 },
  clamp: { min: 3, max: 3 },
  if: { min: 3, max: 3 },
  coalesce: VARIADIC,
  isnull: ONE,
  contains: { min: 2, max: 2 },
  len: ONE,
});

export const FUNCTION_NAMES: readonly string[] = Object.freeze(Object.keys(FUNCTION_ARITY));

/** Keywords of the language. */
export const KEYWORDS: readonly string[] = Object.freeze(["and", "or", "not", "true", "false", "null"]);

/** Identifiers that can never be field keys: keywords and every function name. */
export const RESERVED_WORDS: readonly string[] = Object.freeze([...KEYWORDS, ...FUNCTION_NAMES]);

const reservedSet = new Set(RESERVED_WORDS);
const functionSet = new Set(FUNCTION_NAMES);

export function isReservedWord(name: string): boolean {
  return reservedSet.has(name);
}

export function isFunctionName(name: string): boolean {
  return functionSet.has(name);
}

export function arityText(arity: Arity): string {
  if (arity.max === Infinity) return `at least ${arity.min} argument${arity.min === 1 ? "" : "s"}`;
  if (arity.min === arity.max) return `${arity.min} argument${arity.min === 1 ? "" : "s"}`;
  return `${arity.min} to ${arity.max} arguments`;
}
