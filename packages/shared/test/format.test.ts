import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINOLOGY,
  addDays,
  athleteLabel,
  compareISODate,
  dateInTimeZone,
  dateRange,
  diffDays,
  flagColor,
  formatMetricValue,
  isISODate,
  isValidTimeZone,
  isoWeekday,
  parseISODate,
  terminology,
  todayInTimeZone,
} from "../src/format";

describe("athleteLabel", () => {
  const base = { code: "P-014", display_name: "Sam Lee", masked: false, first_name: "Samuel", last_name: "Lee", preferred_name: "Sam" };

  it("uses display_name, or the code when masked", () => {
    expect(athleteLabel(base)).toBe("Sam Lee");
    expect(athleteLabel(base, { withCode: true })).toBe("Sam Lee (P-014)");
    const masked = { ...base, masked: true, display_name: "P-014", first_name: null, last_name: null, preferred_name: null };
    expect(athleteLabel(masked)).toBe("P-014");
    expect(athleteLabel(masked, { withCode: true })).toBe("P-014");
  });

  it("falls back to names, then the code", () => {
    expect(athleteLabel({ code: "A-1", first_name: "Ana", last_name: "Silva" })).toBe("Ana Silva");
    expect(athleteLabel({ code: "A-1", preferred_name: "Nana", first_name: "Ana", last_name: "Silva" })).toBe("Nana Silva");
    expect(athleteLabel({ code: "A-1" })).toBe("A-1");
    expect(athleteLabel({ code: "A-1", display_name: "" })).toBe("A-1");
  });
});

describe("flagColor", () => {
  it("maps flags to semantic tokens", () => {
    expect(flagColor("green")).toBe("green");
    expect(flagColor("amber")).toBe("amber");
    expect(flagColor("red")).toBe("red");
    expect(flagColor(null)).toBe("none");
    expect(flagColor(undefined)).toBe("none");
  });
});

describe("formatMetricValue", () => {
  it("rounds half away from zero to the metric's decimals and appends the unit", () => {
    expect(formatMetricValue(1.125, { decimals: 2, unit: "AU" })).toBe("1.13 AU");
    // Same formula as the form engine, so binary representation applies: 1.255 is 1.25499...
    expect(formatMetricValue(1.255, { decimals: 2 })).toBe("1.25");
    expect(formatMetricValue(630, { decimals: 0, unit: "AU" })).toBe("630 AU");
    expect(formatMetricValue(2.5, { decimals: 0, unit: null })).toBe("3");
    expect(formatMetricValue(-2.5, { decimals: 0 })).toBe("-3");
    expect(formatMetricValue(-0.04, { decimals: 1, unit: "%" })).toBe("0.0%");
    expect(formatMetricValue(1.2, { decimals: 3, unit: "z" })).toBe("1.200 z");
    expect(formatMetricValue(1.2, { decimals: 1, unit: "ms" }, { unit: false })).toBe("1.2");
  });

  it("shows missing values as a dash (or the given text)", () => {
    expect(formatMetricValue(null, { decimals: 1, unit: "ms" })).toBe("–");
    expect(formatMetricValue(undefined, { decimals: 1 })).toBe("–");
    expect(formatMetricValue(Number.NaN, { decimals: 1 }, { empty: "n/a" })).toBe("n/a");
  });

  it("formats with a locale when asked", () => {
    expect(formatMetricValue(12345.678, { decimals: 1, unit: "steps" }, { locale: "en-US" })).toBe("12,345.7 steps");
    expect(formatMetricValue(1234.5, { decimals: 2 }, { locale: "de-DE" })).toBe("1.234,50");
  });
});

describe("terminology", () => {
  it("merges org labels over the defaults", () => {
    expect(terminology(null)).toEqual(DEFAULT_TERMINOLOGY);
    expect(terminology({ settings: { terminology: { athlete: "Operator", athletes: "Operators", group: " ", groups: "Units" } } })).toEqual({
      athlete: "Operator",
      athletes: "Operators",
      group: "Group",
      groups: "Units",
    });
    expect(terminology({ settings: null })).toEqual({ athlete: "Athlete", athletes: "Athletes", group: "Group", groups: "Groups" });
  });
});

describe("ISO date arithmetic", () => {
  const originalTZ = process.env.TZ;
  afterAll(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });

  // The device time zone must never matter for calendar arithmetic.
  for (const tz of ["UTC", "America/New_York", "Europe/London", "Australia/Lord_Howe", "Pacific/Kiritimati", "America/Sao_Paulo"]) {
    describe(`with TZ=${tz}`, () => {
      beforeAll(() => {
        process.env.TZ = tz;
      });

      it("addDays crosses DST changes, month and year ends, leap days", () => {
        expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
        expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
        expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
        expect(addDays("2026-10-04", 1)).toBe("2026-10-05");
        expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
        expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
        expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
        expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
        expect(addDays("2026-01-31", 365)).toBe("2027-01-31");
        expect(addDays("2026-10-12", 0)).toBe("2026-10-12");
      });

      it("dateRange is inclusive and DST-proof", () => {
        expect(dateRange("2026-03-06", "2026-03-10")).toEqual([
          "2026-03-06",
          "2026-03-07",
          "2026-03-08",
          "2026-03-09",
          "2026-03-10",
        ]);
        expect(dateRange("2026-10-31", "2026-11-02")).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
        expect(dateRange("2026-10-12", "2026-10-12")).toEqual(["2026-10-12"]);
        expect(dateRange("2026-10-12", "2026-10-11")).toEqual([]);
        expect(dateRange("2025-01-01", "2025-12-31")).toHaveLength(365);
      });

      it("diffDays, compareISODate and isoWeekday", () => {
        expect(diffDays("2026-03-01", "2026-04-01")).toBe(31);
        expect(diffDays("2026-11-02", "2026-10-31")).toBe(-2);
        expect(compareISODate("2026-10-12", "2026-10-11")).toBeGreaterThan(0);
        expect(compareISODate("2026-10-12", "2026-10-12")).toBe(0);
        expect(isoWeekday("2026-10-12")).toBe(1); // Monday
        expect(isoWeekday("2026-10-18")).toBe(7); // Sunday
        expect(isoWeekday("1970-01-01")).toBe(4); // Thursday
        expect(isoWeekday("1969-12-29")).toBe(1);
      });

      it("todayInTimeZone ignores the device zone", () => {
        expect(todayInTimeZone("Asia/Tokyo", Date.parse("2026-10-12T15:30:00Z"))).toBe("2026-10-13");
      });
    });
  }

  it("validates ISO dates", () => {
    expect(parseISODate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(() => parseISODate("2023-02-29")).toThrow(RangeError);
    expect(() => addDays("2026-13-01", 1)).toThrow(RangeError);
    expect(() => addDays("2026-10-12", 0.5)).toThrow(RangeError);
    expect(isISODate("2026-10-12")).toBe(true);
    expect(isISODate("2026-10-12T00:00:00Z")).toBe(false);
    expect(isISODate(20261012)).toBe(false);
    expect(addDays("0050-12-31", 1)).toBe("0051-01-01");
  });
});

describe("todayInTimeZone / dateInTimeZone", () => {
  const at = (iso: string) => new Date(iso);

  it("uses the zone's calendar day around midnight", () => {
    const instant = at("2026-10-12T03:30:00Z");
    expect(todayInTimeZone("UTC", instant)).toBe("2026-10-12");
    expect(todayInTimeZone("America/New_York", instant)).toBe("2026-10-11"); // 23:30 EDT
    expect(todayInTimeZone("America/Los_Angeles", instant)).toBe("2026-10-11");
    expect(todayInTimeZone("Asia/Kolkata", instant)).toBe("2026-10-12"); // 09:00 IST
    expect(todayInTimeZone("Pacific/Kiritimati", at("2026-10-12T10:00:00Z"))).toBe("2026-10-13"); // UTC+14
    expect(todayInTimeZone("Pacific/Pago_Pago", at("2026-10-12T10:00:00Z"))).toBe("2026-10-11"); // UTC-11
    // Chatham Islands: UTC+13:45 in (southern) summer time.
    expect(todayInTimeZone("Pacific/Chatham", at("2026-10-12T10:14:59Z"))).toBe("2026-10-12"); // 23:59:59
    expect(todayInTimeZone("Pacific/Chatham", at("2026-10-12T10:15:00Z"))).toBe("2026-10-13"); // 00:00
  });

  it("handles DST transitions in New York (2026-03-08 and 2026-11-01)", () => {
    // Spring forward: 02:00 EST -> 03:00 EDT at 07:00Z.
    expect(dateInTimeZone("2026-03-08T04:59:59Z", "America/New_York")).toBe("2026-03-07"); // 23:59:59 EST
    expect(dateInTimeZone("2026-03-08T05:00:00Z", "America/New_York")).toBe("2026-03-08"); // 00:00 EST
    expect(dateInTimeZone("2026-03-09T03:59:59Z", "America/New_York")).toBe("2026-03-08"); // 23:59:59 EDT
    expect(dateInTimeZone("2026-03-09T04:00:00Z", "America/New_York")).toBe("2026-03-09");
    // Fall back: 02:00 EDT -> 01:00 EST at 06:00Z.
    expect(dateInTimeZone("2026-11-01T03:59:59Z", "America/New_York")).toBe("2026-10-31");
    expect(dateInTimeZone("2026-11-01T04:00:00Z", "America/New_York")).toBe("2026-11-01"); // 00:00 EDT
    expect(dateInTimeZone("2026-11-02T04:59:59Z", "America/New_York")).toBe("2026-11-01"); // 23:59:59 EST
    expect(dateInTimeZone("2026-11-02T05:00:00Z", "America/New_York")).toBe("2026-11-02");
  });

  it("handles a southern-hemisphere DST change (Sydney, 2026-10-04)", () => {
    expect(dateInTimeZone("2026-10-03T13:59:59Z", "Australia/Sydney")).toBe("2026-10-03"); // 23:59:59 AEST
    expect(dateInTimeZone("2026-10-03T14:00:00Z", "Australia/Sydney")).toBe("2026-10-04");
    expect(dateInTimeZone("2026-10-04T12:59:59Z", "Australia/Sydney")).toBe("2026-10-04"); // 23:59:59 AEDT
    expect(dateInTimeZone("2026-10-04T13:00:00Z", "Australia/Sydney")).toBe("2026-10-05");
  });

  it("accepts ISO strings with offsets and epoch milliseconds", () => {
    expect(dateInTimeZone("2026-10-12T06:31:00-04:00", "Europe/Berlin")).toBe("2026-10-12");
    expect(dateInTimeZone("2026-10-12T23:31:00-04:00", "Europe/Berlin")).toBe("2026-10-13");
    expect(dateInTimeZone(0, "UTC")).toBe("1970-01-01");
  });

  it("rejects unknown zones and invalid instants", () => {
    expect(() => todayInTimeZone("Mars/Olympus_Mons")).toThrow(RangeError);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(() => dateInTimeZone("not a date", "UTC")).toThrow(RangeError);
  });

  it("defaults to now", () => {
    const today = todayInTimeZone("UTC");
    expect(today).toBe(new Date().toISOString().slice(0, 10));
  });
});
