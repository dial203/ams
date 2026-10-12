import { act, fireEvent, screen } from "@testing-library/react-native";
import { ApiError, type DueForm } from "@ams/shared";
import { athlete, makeDueForm, SPEC } from "../../test/fixtures";
import { mockRouter } from "../../test/expoRouterMock";
import { renderApp } from "../../test/renderApp";
import { dueFormState, sortDueForms, TodayScreen } from "../TodayScreen";
import type { MockHandler } from "../../test/fetchMock";

const NOW = Date.parse("2026-10-12T10:00:00Z"); // 10:00 in the org's time zone (UTC)

const wellness = makeDueForm("f-wellness", "Morning wellness", SPEC.schemas.wellness, { due_time: "09:00" });
const srpe = makeDueForm("f-srpe", "Session RPE", SPEC.schemas.session, { due_time: "18:00" });
const injury = makeDueForm("f-injury", "Injury report", SPEC.schemas.types);
const done = makeDueForm("f-mass", "Body mass", SPEC.schemas.types, {
  due_time: "07:00",
  completed: true,
  last_submitted_at: "2026-10-12T07:12:00Z",
});

function routes(forms: MockHandler): Record<string, MockHandler> {
  return {
    "GET /orgs/org-1/me/athlete": { body: athlete },
    "GET /orgs/org-1/me/forms": forms,
    "GET /orgs/org-1/me/metrics": { body: [] },
  };
}

beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TodayScreen", () => {
  it("greets the athlete with the org's terminology and shows the health sync chip", async () => {
    await renderApp(<TodayScreen />, { routes: routes({ body: [] }) });
    expect(await screen.findByText("Good morning, Sam")).toBeOnTheScreen();
    expect(screen.getByText("Rower R-014 · Riverside Rowing")).toBeOnTheScreen();
    expect(screen.getByText("Monday 12 October")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Health sync needs the development build" })).toBeOnTheScreen();
  });

  it("asks for today's date in the athlete's time zone", async () => {
    const app = await renderApp(<TodayScreen />, { routes: routes({ body: [] }) });
    await screen.findByText("Nothing to fill in today");
    expect(app.callsTo("GET /orgs/org-1/me/forms")[0]!.query).toEqual({ date: "2026-10-12" });
  });

  it("shows a loading state, then the forms", async () => {
    let resolve!: (r: { body: DueForm[] }) => void;
    await renderApp(<TodayScreen />, {
      routes: routes(() => new Promise((r) => (resolve = r))),
    });
    expect(screen.getByLabelText("Loading today's forms…")).toBeOnTheScreen();
    await act(async () => resolve({ body: [srpe] }));
    expect(await screen.findByText("Session RPE")).toBeOnTheScreen();
  });

  it("shows an error with a retry", async () => {
    let fail = true;
    await renderApp(<TodayScreen />, {
      routes: routes(() => (fail ? { status: 500, body: { detail: "boom" } } : { body: [srpe] })),
    });
    expect(await screen.findByText("Couldn't load this")).toBeOnTheScreen();
    fail = false;
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Session RPE")).toBeOnTheScreen();
  });

  it("shows an empty state", async () => {
    await renderApp(<TodayScreen />, { routes: routes({ body: [] }) });
    expect(await screen.findByText("Nothing to fill in today")).toBeOnTheScreen();
  });

  it("lists due forms first by due time, then unscheduled, then completed ones with a check", async () => {
    await renderApp(<TodayScreen />, { routes: routes({ body: [done, injury, srpe, wellness] }) });
    await screen.findByText("Morning wellness");
    expect(screen.getByText("3 to do")).toBeOnTheScreen();

    const rows = screen.getAllByRole("button").filter((b) => String(b.props.testID ?? "").startsWith("due-form-"));
    expect(rows.map((r) => r.props.testID)).toEqual([
      "due-form-f-wellness",
      "due-form-f-srpe",
      "due-form-f-injury",
      "due-form-f-mass",
    ]);
    expect(screen.getByText("Overdue · was due 09:00")).toBeOnTheScreen();
    expect(screen.getByText("Due 18:00")).toBeOnTheScreen();
    expect(screen.getByText("Anytime")).toBeOnTheScreen();
    expect(screen.getByText("Done at 07:12")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Body mass. Done at 07:12" })).toBeDisabled();

    await fireEvent.press(screen.getByRole("button", { name: "Session RPE. Due 18:00" }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/form/[formId]", params: { formId: "f-srpe" } });
  });

  it("keeps a repeatable completed form open", async () => {
    const repeat = makeDueForm("f-gps", "Extra session", SPEC.schemas.session, {
      completed: true,
      last_submitted_at: "2026-10-12T08:00:00Z",
      form: { allow_multiple_per_day: true },
    });
    await renderApp(<TodayScreen />, { routes: routes({ body: [repeat] }) });
    const row = await screen.findByRole("button", { name: "Extra session. Done at 08:00 · tap to add another" });
    expect(row).toBeEnabled();
    expect(screen.getByText("All done")).toBeOnTheScreen();
  });

  it("keeps showing cached forms when a refresh fails", async () => {
    let fail = false;
    const app = await renderApp(<TodayScreen />, {
      routes: routes(() => (fail ? new ApiError({ status: 500, detail: "x" }) : { body: [srpe] })),
    });
    await screen.findByText("Session RPE");
    fail = true;
    await act(() => app.queryClient.refetchQueries());
    expect(await screen.findByText("Couldn't refresh. Showing saved data.")).toBeOnTheScreen();
    expect(screen.getByText("Session RPE")).toBeOnTheScreen();
  });
});

describe("due form helpers", () => {
  it("derives the row state", () => {
    expect(dueFormState(wellness, 9 * 60 + 1)).toBe("overdue");
    expect(dueFormState(wellness, 9 * 60)).toBe("due");
    expect(dueFormState(injury, 0)).toBe("anytime");
    expect(dueFormState(done, 0)).toBe("done");
  });

  it("sorts stably", () => {
    expect(sortDueForms([done, injury, srpe, wellness]).map((d) => d.form.id)).toEqual([
      "f-wellness",
      "f-srpe",
      "f-injury",
      "f-mass",
    ]);
  });
});
