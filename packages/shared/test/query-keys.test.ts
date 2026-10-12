import { describe, expect, it } from "vitest";
import { normalizeParams, queryKeys } from "../src/api";

function startsWith(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.every((p, i) => JSON.stringify(p) === JSON.stringify(key[i]));
}

describe("queryKeys", () => {
  it("normalises params so equal params give equal keys", () => {
    const a = queryKeys.athletes.list("o", { q: "lee", group_id: null, status: undefined, limit: 50 });
    const b = queryKeys.athletes.list("o", { limit: 50, q: "lee" });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toEqual(["ams", "org", "o", "athletes", "list", { limit: 50, q: "lee" }]);
    expect(queryKeys.athletes.list("o")).toEqual(["ams", "org", "o", "athletes", "list", {}]);
    expect(normalizeParams({ b: 1, a: [1, 2], c: null })).toEqual({ a: [1, 2], b: 1 });
  });

  it("nests keys so prefixes invalidate the right queries", () => {
    const org = queryKeys.org("o");
    const all = queryKeys.athletes.all("o");
    const lists = queryKeys.athletes.lists("o");
    const list = queryKeys.athletes.list("o", { q: "x" });
    const detail = queryKeys.athletes.detail("o", "a1");
    expect(startsWith(list, lists)).toBe(true);
    expect(startsWith(lists, all)).toBe(true);
    expect(startsWith(detail, all)).toBe(true);
    expect(startsWith(detail, lists)).toBe(false);
    expect(startsWith(all, org)).toBe(true);
    expect(startsWith(queryKeys.athletes.list("o2"), org)).toBe(false);

    expect(startsWith(queryKeys.forms.versions("o", "f"), queryKeys.forms.detail("o", "f"))).toBe(true);
    expect(startsWith(queryKeys.forms.schedules("o", "f"), queryKeys.forms.all("o"))).toBe(true);
    expect(startsWith(queryKeys.groups.staff("o", "g"), queryKeys.groups.detail("o", "g"))).toBe(true);
    expect(startsWith(queryKeys.wearables.daily("o", "a", { metrics: ["steps"] }), queryKeys.wearables.athlete("o", "a"))).toBe(true);
    expect(startsWith(queryKeys.self.forms("o", { date: "2026-10-12" }), queryKeys.self.all("o"))).toBe(true);
    expect(startsWith(queryKeys.metrics.series("o", "acwr", { athlete_id: "a" }), queryKeys.metrics.allSeries("o"))).toBe(true);
  });

  it("gives distinct keys for distinct resources", () => {
    const keys = [
      queryKeys.me(),
      queryKeys.invite("t"),
      queryKeys.orgs.detail("o"),
      queryKeys.members.list("o"),
      queryKeys.invitations.list("o"),
      queryKeys.groups.list("o"),
      queryKeys.groups.detail("o", "g"),
      queryKeys.athletes.detail("o", "a"),
      queryKeys.forms.list("o"),
      queryKeys.forms.detail("o", "f"),
      queryKeys.formTemplates.list("o"),
      queryKeys.submissions.list("o", { form_id: "f" }),
      queryKeys.submissions.detail("o", "s"),
      queryKeys.imports.list("o"),
      queryKeys.self.athlete("o"),
      queryKeys.self.submissions("o"),
      queryKeys.self.metrics("o"),
      queryKeys.self.wearables("o"),
      queryKeys.self.wearableProviders("o"),
      queryKeys.wearables.providers("o"),
      queryKeys.wearables.status("o", "a"),
      queryKeys.metrics.list("o"),
      queryKeys.metrics.seriesSources("o"),
      queryKeys.dashboards.readiness("o", { date: "2026-10-12" }),
      queryKeys.audit.list("o"),
    ].map((k) => JSON.stringify(k));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
