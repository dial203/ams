import type { MetricDefinition, ReadinessBoard, ReadinessCell, ReadinessMissing } from "@ams/shared";
import { describe, expect, it } from "vitest";
import { missingLabel, missingText, parseSource, setupItems } from "@/components/readiness/missing";

function metric(slug: string, name: string, source: string): MetricDefinition {
  return {
    id: slug,
    org_id: "o",
    slug,
    name,
    description: null,
    unit: null,
    source,
    daily_agg: "last",
    fill_zero: false,
    transform: "none",
    params: {},
    thresholds: null,
    decimals: 0,
    athlete_visible: false,
    builtin: true,
  };
}

function missing(reason: ReadinessMissing["reason"], extra: Partial<ReadinessMissing> = {}): ReadinessCell {
  return {
    value: null,
    flag: null,
    date: null,
    missing: { reason, source: null, last_date: null, have: null, need: null, window: null, same_source: false, ...extra },
  };
}

const value = (v: number): ReadinessCell => ({ value: v, flag: "green", date: "2026-10-13", missing: null });

const columns = [
  metric("wellness_hooper", "Wellness", "form:wellness_hooper.hooper_total"),
  metric("hrv_z", "HRV z", "wearable:hrv_rmssd_ms"),
  metric("sleep_duration", "Sleep", "wearable:sleep_duration_min"),
  metric("acwr", "ACWR", "metric:srpe_load"),
];

describe("empty readiness cells", () => {
  it("parses series refs", () => {
    expect(parseSource("form:wellness_hooper.hooper_total")).toEqual({ kind: "form", name: "wellness_hooper" });
    expect(parseSource("wearable:hrv_rmssd_ms")).toEqual({ kind: "wearable", name: "hrv_rmssd_ms" });
    expect(parseSource("metric:srpe_load")).toEqual({ kind: "metric", name: "srpe_load" });
    expect(parseSource(null)).toEqual({ kind: null, name: "" });
  });

  it("labels each reason briefly and explains it in full", () => {
    const day = "2026-10-14";
    const building = missing("building", {
      source: "wearable:hrv_rmssd_ms",
      last_date: day,
      have: 8,
      need: 21,
      window: 60,
      same_source: true,
    }).missing!;
    expect(missingLabel(building, day)).toBe("8/21d");
    expect(missingText(building, columns[1]!, day)).toMatch(/^Baseline building: 8 of 21 days from the same device within 60 days/);
    const stale = missing("stale", { last_date: "2026-10-06", source: "form:wellness_hooper.hooper_total" }).missing!;
    expect(missingLabel(stale, day)).toBe("8d ago");
    expect(missingText(stale, columns[0]!, day)).toContain("8 days before the board date");
    const noForm = missing("no_source", { source: "form:wellness_hooper.hooper_total" }).missing!;
    expect(missingLabel(noForm, day)).toBe("no form");
    expect(missingText(noForm, columns[0]!, day)).toContain("“wellness_hooper”, which does not exist yet");
    expect(missingLabel(missing("not_linked").missing!, day)).toBe("no wearable");
    expect(missingText(missing("no_data", { source: "wearable:hrv_rmssd_ms" }).missing!, columns[1]!, day)).toContain(
      "has sent no hrv_rmssd_ms data",
    );
    // restricted says nothing about whether data exists
    expect(missingText(missing("restricted").missing!, columns[0]!, day)).toBe(
      "Your access does not cover the data Wellness is calculated from for this athlete.",
    );
  });

  it("collects board-wide setup steps, worst first", () => {
    const board: ReadinessBoard = {
      date: "2026-10-14",
      group_id: null,
      columns,
      rows: [
        {
          athlete: { id: "a1", display_name: "Michael Dial", code: "A-0001", position: null },
          cells: {
            wellness_hooper: missing("no_source", { source: "form:wellness_hooper.hooper_total" }),
            hrv_z: missing("building", { source: "wearable:hrv_rmssd_ms", have: 8, need: 21, window: 60, same_source: true }),
            sleep_duration: value(363),
            acwr: missing("no_source", { source: "form:session_rpe.srpe" }),
          },
          due_forms: 0,
          scheduled_forms: 0,
        },
        {
          athlete: { id: "a2", display_name: "Ana Ruiz", code: "A-0002", position: null },
          cells: {
            wellness_hooper: missing("no_source", { source: "form:wellness_hooper.hooper_total" }),
            hrv_z: missing("building", { source: "wearable:hrv_rmssd_ms", have: 20, need: 21, window: 60, same_source: true }),
            sleep_duration: missing("no_data", { source: "wearable:sleep_duration_min" }),
            acwr: missing("no_source", { source: "form:session_rpe.srpe" }),
          },
          due_forms: 0,
          scheduled_forms: 2,
        },
        {
          athlete: { id: "a3", display_name: "Cy Dunn", code: "A-0003", position: null },
          cells: {
            wellness_hooper: missing("no_source", { source: "form:wellness_hooper.hooper_total" }),
            hrv_z: missing("not_linked", { source: "wearable:hrv_rmssd_ms" }),
            sleep_duration: missing("not_linked", { source: "wearable:sleep_duration_min" }),
            acwr: missing("no_source", { source: "form:session_rpe.srpe" }),
          },
          due_forms: 0,
          scheduled_forms: 2,
        },
      ],
    };
    const items = setupItems(board);
    expect(items.map((i) => i.kind)).toEqual(["no_source", "no_source", "not_linked", "no_device_data", "building", "no_schedule"]);
    expect(items[0]).toMatchObject({ kind: "no_source", formSlug: "wellness_hooper" });
    expect(items[1]).toMatchObject({ kind: "no_source", formSlug: "session_rpe", source: "form:session_rpe.srpe" });
    expect(items[2]).toMatchObject({ kind: "not_linked", athletes: [{ id: "a3" }] });
    expect(items[2]!.kind === "not_linked" && items[2]!.metrics.map((m) => m.slug)).toEqual(["hrv_z", "sleep_duration"]);
    expect(items[3]).toMatchObject({ kind: "no_device_data", source: "wearable:sleep_duration_min", athletes: 1 });
    expect(items[4]).toMatchObject({ kind: "building", athletes: 2, minLeft: 1, maxLeft: 13 });
    expect(items[5]).toMatchObject({ kind: "no_schedule", athletes: 1, total: 3 });
  });

  it("has nothing to say about a fully populated board", () => {
    const board: ReadinessBoard = {
      date: "2026-10-14",
      group_id: null,
      columns: columns.slice(0, 1),
      rows: [
        {
          athlete: { id: "a1", display_name: "Ana", code: "A-1", position: null },
          cells: { wellness_hooper: value(10) },
          due_forms: 1,
          scheduled_forms: 1,
        },
      ],
    };
    expect(setupItems(board)).toEqual([]);
  });
});
