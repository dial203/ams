import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Absolute path of a file in the repo-level `spec/` directory. */
export function specPath(name: string): string {
  return fileURLToPath(new URL(`../../../spec/${name}`, import.meta.url));
}

export function loadSpec<T>(name: string): T {
  return JSON.parse(readFileSync(specPath(name), "utf8")) as T;
}

/** Numbers equal within relative tolerance 1e-9 (absolute 1e-9 near zero). */
export function numbersClose(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= 1e-9 * Math.max(scale, 1);
}

/** Deep equality for JSON-like values with numeric tolerance. */
export function jsonClose(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return numbersClose(a, b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => jsonClose(x, b[i]));
  }
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => jsonClose((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
