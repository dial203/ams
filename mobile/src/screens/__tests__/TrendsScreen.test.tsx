import { fireEvent, screen } from "@testing-library/react-native";
import { athlete, makeDueForm, makeSubmission, metricSeries, SPEC } from "../../test/fixtures";
import type { MockHandler } from "../../test/fetchMock";
import { renderApp } from "../../test/renderApp";
import { describeSeries, TrendsScreen } from "../TrendsScreen";

const NOW = Date.parse("2026-10-28T09:00:00Z");
const values = [10, 11, null, 12, 13, 17, 14, 21, ...Array.from({ length: 19 }, () => null), 15];
const wellness = metricSeries("wellness", "Wellness (Hooper)", values);
const session = makeDueForm("f1", "Session RPE", SPEC.schemas.session);

function routes(metrics: MockHandler): Record<string, MockHandler> {
  return {
    "GET /orgs/org-1/me/athlete": { body: athlete },
    "GET /orgs/org-1/me/metrics": metrics,
    "GET /orgs/org-1/me/forms": { body: [session] },
    "GET /orgs/org-1/me/submissions": {
      body: {
        items: [
          makeSubmission("f1", {
            local_date: "2026-10-27",
            observed_at: "2026-10-27T18:30:00Z",
            values: { session_type: "field", rpe: 7, duration: 60 },
            computed: { srpe: 420, load_band: "moderate", duration_h: 1, duration_back: 60 },
          }),
        ],
        total: 1,
      },
    },
  };
}

beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => jest.restoreAllMocks());

describe("TrendsScreen", () => {
  it("shows athlete-visible metrics over four weeks with flag labels", async () => {
    const app = await renderApp(<TrendsScreen />, { routes: routes({ body: [wellness] }) });
    expect(await screen.findByText("Wellness (Hooper)")).toBeOnTheScreen();
    expect(app.callsTo("GET /orgs/org-1/me/metrics")[0]!.query).toEqual({ start: "2026-10-01", end: "2026-10-28" });
    expect(screen.getByText("15 AU")).toBeOnTheScreen();
    expect(screen.getByLabelText("Flag: OK")).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Wellness \(Hooper\): latest 15 AU today, flag OK\. 8 of 28 days have data/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "About this metric" }));
    expect(screen.getByText("How you feel overall.")).toBeOnTheScreen();
  });

  it("lists recent submissions with labels from the form", async () => {
    await renderApp(<TrendsScreen />, { routes: routes({ body: [wellness] }) });
    expect(await screen.findByText("Session RPE")).toBeOnTheScreen();
    expect(screen.getByText("Yesterday · 18:30")).toBeOnTheScreen();
    expect(screen.getByText("Session load: 420 AU")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Session RPE, Yesterday · 18:30" }));
    expect(screen.getByText("Session RPE (CR-10): Very hard")).toBeOnTheScreen();
    expect(screen.getByText("Duration: 1 h")).toBeOnTheScreen();
  });

  it("explains when no metrics are shared", async () => {
    await renderApp(<TrendsScreen />, { routes: routes({ body: [] }) });
    expect(await screen.findByText("No metrics yet")).toBeOnTheScreen();
  });

  it("summarises a series for screen readers", () => {
    expect(describeSeries(metricSeries("x", "Load", [null, null]), "2026-10-28")).toBe("Load: no data in the last 28 days.");
  });
});
