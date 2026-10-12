import type { SelectField } from "@ams/shared";
import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatFieldValue,
  isoToLocalDateTime,
  localDateTimeToISO,
  parseDurationInput,
  parseNumberInput,
  rangeHint,
} from "@/lib/field-format";

describe("field-format", () => {
  it("parses numbers, keeping unparseable text for validation", () => {
    expect(parseNumberInput("")).toBeUndefined();
    expect(parseNumberInput(" 7.5 ")).toBe(7.5);
    expect(parseNumberInput("7,5")).toBe(7.5);
    expect(parseNumberInput("-3")).toBe(-3);
    expect(parseNumberInput("1e3")).toBe(1000);
    expect(parseNumberInput("1.")).toBe(1);
    expect(parseNumberInput("abc")).toBe("abc");
  });

  it("parses durations in minutes, h:mm and h/m notation", () => {
    expect(parseDurationInput("90")).toBe(90);
    expect(parseDurationInput("1:30")).toBe(90);
    expect(parseDurationInput("1h30")).toBe(90);
    expect(parseDurationInput("1h 30m")).toBe(90);
    expect(parseDurationInput("1.5h")).toBe(90);
    expect(parseDurationInput("45min")).toBe(45);
    expect(parseDurationInput("soon")).toBe("soon");
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
  });

  it("round-trips datetime-local values with the local offset", () => {
    const iso = localDateTimeToISO("2026-10-12T06:30")!;
    expect(iso).toMatch(/^2026-10-12T06:30:00([+-]\d{2}:\d{2})$/);
    expect(isoToLocalDateTime(iso)).toBe("2026-10-12T06:30");
    expect(localDateTimeToISO("nope")).toBeUndefined();
  });

  it("formats values by field type", () => {
    const select: SelectField = { key: "s", type: "select", label: "S", options: [{ value: 1, label: "One" }] };
    expect(formatFieldValue(select, 1)).toBe("One");
    expect(formatFieldValue({ key: "b", type: "boolean", label: "B" }, false)).toBe("No");
    expect(formatFieldValue({ key: "n", type: "number", label: "N", unit: "kg", decimals: 1 }, 80.25)).toBe("80.3 kg");
    expect(formatFieldValue({ key: "c", type: "calculated", label: "C", expression: "1", unit: "%" }, 12)).toBe("12%");
    expect(formatFieldValue({ key: "n", type: "number", label: "N" }, null)).toBe("–");
    expect(rangeHint(0, 24, "h")).toBe("0–24 h");
    expect(rangeHint(undefined, 10)).toBe("≤ 10");
  });
});
