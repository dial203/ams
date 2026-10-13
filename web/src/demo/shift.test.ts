import { describe, expect, it } from "vitest";
import { shiftDates, shiftDateString } from "./shift";

describe("shiftDateString", () => {
  it("moves ISO dates by whole days across months and years", () => {
    expect(shiftDateString("2026-10-12", 1)).toBe("2026-10-13");
    expect(shiftDateString("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDateString("2026-12-30", 5)).toBe("2027-01-04");
    expect(shiftDateString("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("moves date-times and keeps the time of day and the offset", () => {
    expect(shiftDateString("2026-10-12T06:31:00Z", 3)).toBe("2026-10-15T06:31:00Z");
    expect(shiftDateString("2026-10-12T07:12:00-04:00", 2)).toBe("2026-10-14T07:12:00-04:00");
    expect(shiftDateString("2026-10-12T23:59:59.123456+05:30", -12)).toBe("2026-09-30T23:59:59.123456+05:30");
    expect(shiftDateString("2026-10-13T15:14:17.834338Z", 30)).toBe("2026-11-12T15:14:17.834338Z");
    expect(shiftDateString("2026-10-12T06:31", 1)).toBe("2026-10-13T06:31");
  });

  it("leaves other strings alone", () => {
    for (const s of [
      "A-0001",
      "Morning wellness",
      "2026-10-12 notes",
      "on 2026-10-12",
      "2026-13-01",
      "2026-02-30",
      "2026-10-12T25:00",
      "9b7e6b8e-2c4f-4d55-9a0e-0f6a4c3c1d2e",
      "20261012",
      "",
    ]) {
      expect(shiftDateString(s, 7)).toBe(s);
    }
  });

  it("is the identity for a zero shift", () => {
    expect(shiftDateString("2026-10-12", 0)).toBe("2026-10-12");
  });
});

describe("shiftDates", () => {
  it("shifts nested values and date keys without touching the input", () => {
    const input = {
      generated_on: "2026-10-12",
      count: 3,
      flag: null,
      ok: true,
      code: "A-0001",
      points: [["2026-10-11", 1.5, "green", "oura/Oura Ring Gen3"]],
      boards: { "2026-10-12": { date: "2026-10-12", rows: [] } },
      submission: { observed_at: "2026-10-12T11:59:00Z", values: { note: "felt fine on 2026-10-10" } },
    };
    const copy = JSON.parse(JSON.stringify(input)) as typeof input;
    const out = shiftDates(input, 2);
    expect(out).toEqual({
      generated_on: "2026-10-14",
      count: 3,
      flag: null,
      ok: true,
      code: "A-0001",
      points: [["2026-10-13", 1.5, "green", "oura/Oura Ring Gen3"]],
      boards: { "2026-10-14": { date: "2026-10-14", rows: [] } },
      submission: { observed_at: "2026-10-14T11:59:00Z", values: { note: "felt fine on 2026-10-10" } },
    });
    expect(input).toEqual(copy);
  });
});
