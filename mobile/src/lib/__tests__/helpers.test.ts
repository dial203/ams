import { athleteMemberships, resolveMembership, toActiveMembership } from "../session/membership";
import { apiUrlFromHostUri, normalizeApiUrl, resolveApiUrl, serverHost } from "../config";
import {
  formatDuration,
  formatLongDate,
  formatRelativeDay,
  formatTimeAgo,
  formatTimeInZone,
  minutesInZone,
  parseClock,
  pickTimeZone,
  toLocalIsoWithOffset,
} from "../format";
import { isNetworkError, isWearablesNotConfigured } from "../errors";
import { shouldRetry } from "../queryClient";
import { ApiError, type Me } from "@ams/shared";
import { linePath, thresholdLines, yDomain } from "../../components/charts";
import { displayFieldValue, stripMarkdown } from "../../components/forms";
import { me, org, SPEC } from "../../test/fixtures";

describe("API URL", () => {
  it("appends /api/v1 when missing", () => {
    expect(normalizeApiUrl("http://192.168.1.20:8001/")).toBe("http://192.168.1.20:8001/api/v1");
    expect(normalizeApiUrl("https://ams.example.org/api/v1")).toBe("https://ams.example.org/api/v1");
  });

  it("prefers EXPO_PUBLIC_API_URL, then extra.apiUrl, then the Metro host on port 8001", () => {
    expect(resolveApiUrl("http://10.0.0.5:8001", "http://x", "192.168.1.9:8081")).toBe("http://10.0.0.5:8001/api/v1");
    expect(resolveApiUrl(undefined, "https://ams.example.org", "192.168.1.9:8081")).toBe("https://ams.example.org/api/v1");
    expect(resolveApiUrl("", null, "192.168.1.9:8081")).toBe("http://192.168.1.9:8001/api/v1");
    expect(resolveApiUrl(undefined, undefined, null)).toBe("http://localhost:8001/api/v1");
    expect(apiUrlFromHostUri("exp://192.168.1.9:8081/--/")).toBe("http://192.168.1.9:8001");
    expect(serverHost("http://192.168.1.9:8001/api/v1")).toBe("192.168.1.9:8001");
  });
});

describe("memberships", () => {
  const second = { org: { ...org, id: "org-2", name: "Alpha Unit" }, role: "athlete" as const, athlete_id: "ath-2" };
  const staffOnly = { org: { ...org, id: "org-3", name: "Staff Org" }, role: "staff" as const, athlete_id: null };
  const multi: Me = { ...me, memberships: [...me.memberships, second, staffOnly] };

  it("keeps memberships with an athlete record, sorted by org name", () => {
    expect(athleteMemberships(multi).map((m) => m.org.id)).toEqual(["org-2", "org-1"]);
    expect(athleteMemberships({ ...me, memberships: [staffOnly] })).toEqual([]);
  });

  it("uses the only membership, or the remembered one", () => {
    expect(resolveMembership(athleteMemberships(me), null)?.org.id).toBe("org-1");
    expect(resolveMembership(athleteMemberships(multi), null)).toBeNull();
    expect(resolveMembership(athleteMemberships(multi), "org-2")?.org.id).toBe("org-2");
    expect(resolveMembership(athleteMemberships(multi), "gone")).toBeNull();
  });

  it("carries the org's terminology", () => {
    expect(toActiveMembership(me.memberships[0]!).terminology.athlete).toBe("Rower");
  });
});

describe("format helpers", () => {
  it("formats dates and times", () => {
    expect(formatLongDate("2026-10-12")).toBe("Monday 12 October");
    expect(formatRelativeDay("2026-10-12", "2026-10-12")).toBe("Today");
    expect(formatRelativeDay("2026-10-11", "2026-10-12")).toBe("Yesterday");
    expect(formatRelativeDay("2026-10-05", "2026-10-12")).toBe("Mon 5 Oct");
    expect(formatRelativeDay("2025-12-30", "2026-01-02")).toBe("30 Dec 2025");
    expect(formatTimeInZone("2026-10-12T07:05:00Z", "America/New_York")).toBe("03:05");
    expect(minutesInZone(Date.parse("2026-10-12T23:30:00Z"), "Europe/Berlin")).toBe(90);
    expect(parseClock("09:30")).toBe(570);
    expect(parseClock("25:00")).toBeNull();
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatTimeAgo("2026-10-12T07:00:00Z", Date.parse("2026-10-12T10:00:00Z"))).toBe("3 h ago");
    expect(pickTimeZone(null, "Not/AZone", "Europe/Oslo")).toBe("Europe/Oslo");
    expect(toLocalIsoWithOffset(new Date(2026, 9, 12, 7, 30))).toMatch(/^2026-10-12T07:30:00[+-]\d{2}:\d{2}$/);
  });

  it("shows field values for people", () => {
    const fields = SPEC.schemas.session.sections[0]!.fields;
    const rpe = fields.find((f) => f.key === "rpe");
    const duration = fields.find((f) => f.key === "duration");
    const srpe = fields.find((f) => f.key === "srpe");
    expect(displayFieldValue(rpe, 7)).toBe("Very hard");
    expect(displayFieldValue(duration, 75)).toBe("1 h 15 min");
    expect(displayFieldValue(srpe, 300)).toBe("300 AU");
    expect(displayFieldValue(undefined, true)).toBe("Yes");
    expect(displayFieldValue(undefined, null)).toBe("–");
    expect(stripMarkdown("**Rate** each [item](http://x) for `24 h`")).toBe("Rate each item for 24 h");
  });
});

describe("errors and retries", () => {
  it("recognises network failures and the wearables 503", () => {
    expect(isNetworkError(new TypeError("Network request failed"))).toBe(true);
    expect(isNetworkError(new ApiError({ status: 500, detail: "x" }))).toBe(false);
    expect(isWearablesNotConfigured(new ApiError({ status: 503, detail: "x" }))).toBe(true);
  });

  it("retries network errors and 5xx, never 4xx", () => {
    expect(shouldRetry(0, new TypeError("Network request failed"))).toBe(true);
    expect(shouldRetry(0, new ApiError({ status: 502, detail: "x" }))).toBe(true);
    expect(shouldRetry(2, new ApiError({ status: 502, detail: "x" }))).toBe(false);
    expect(shouldRetry(0, new ApiError({ status: 404, detail: "x" }))).toBe(false);
  });
});

describe("chart scale", () => {
  it("breaks the line where days are missing", () => {
    const pts = [
      { date: "d1", value: 1 },
      { date: "d2", value: 2 },
      { date: "d3", value: null },
      { date: "d4", value: 4 },
    ];
    expect(linePath(pts, (i) => i * 10, (v) => v)).toBe("M0.0,1.0L10.0,2.0M30.0,4.0");
  });

  it("includes nearby thresholds in the domain and mirrors both_bad ones", () => {
    const d = yDomain([10, 12], [15, 100]);
    expect(d.max).toBeGreaterThan(15);
    expect(d.max).toBeLessThan(100);
    expect(thresholdLines({ direction: "both_bad", amber: 1.5, red: 2 }).map((l) => l.value)).toEqual([1.5, -1.5, 2, -2]);
    expect(thresholdLines(null)).toEqual([]);
  });
});
