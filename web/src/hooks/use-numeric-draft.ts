import { useState } from "react";
import { parseNumberInput } from "@/lib/field-format";

function sameInput(a: unknown, b: unknown): boolean {
  return a === b || (a === undefined && (b === null || b === undefined));
}

/**
 * The text of a free-typed numeric input. Keeps the user's draft ("1.", "-", "1,5") while it
 * still parses to the current value; shows the value itself after an external change.
 */
export function useNumericDraft(value: unknown): [string, (text: string) => void] {
  const [draft, setDraft] = useState<string | null>(null);
  const derived = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const shown = draft !== null && sameInput(parseNumberInput(draft), value) ? draft : derived;
  return [shown, setDraft];
}
