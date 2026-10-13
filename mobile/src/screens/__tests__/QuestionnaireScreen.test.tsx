import { todayInTimeZone } from "@ams/shared";
import { fireEvent, screen, within } from "@testing-library/react-native";
import { usePreventRemove } from "expo-router/react-navigation";
import { athlete, makeDueForm, makeSubmission, SPEC } from "../../test/fixtures";
import { mockNavigation } from "../../test/expoRouterMock";
import { networkError, type MockHandler } from "../../test/fetchMock";
import { renderApp } from "../../test/renderApp";
import { QuestionnaireScreen } from "../QuestionnaireScreen";

const session = makeDueForm("f1", "Session RPE", SPEC.schemas.session, {
  form: { description: "How hard was today's session?" },
});

function routes(submit: MockHandler, forms = [session]): Record<string, MockHandler> {
  return {
    "GET /orgs/org-1/me/athlete": { body: athlete },
    "GET /orgs/org-1/me/forms": { body: forms },
    "POST /orgs/org-1/me/submissions": submit,
  };
}

const field = (key: string) => within(screen.getByTestId(`field-${key}`));

async function answerRestDay() {
  await screen.findByRole("header", { name: "Session" });
  await fireEvent.press(field("session_type").getByRole("radio", { name: "Rest" }));
}

const submitButton = () => screen.getByRole("button", { name: "Submit" });

describe("QuestionnaireScreen", () => {
  it("renders the form version's schema, titled with the form name", async () => {
    await renderApp(<QuestionnaireScreen formId="f1" />, { routes: routes({ status: 500 }) });
    expect(await screen.findByText("How hard was today's session?")).toBeOnTheScreen();
    expect(mockNavigation.setOptions).toHaveBeenLastCalledWith({ title: "Session RPE" });
  });

  it("submits visible answers only and shows the server's calculations", async () => {
    const app = await renderApp(<QuestionnaireScreen formId="f1" />, {
      routes: routes({
        status: 201,
        body: makeSubmission("f1", {
          // the success copy compares local_date with today in the org's zone (UTC in the fixtures)
          local_date: todayInTimeZone("UTC"),
          values: { session_type: "field", rpe: 5, duration: 60 },
          computed: { srpe: 300, load_band: "moderate", duration_h: 1, duration_back: 60 },
        }),
      }),
    });
    await screen.findByRole("header", { name: "Session" });
    await fireEvent.press(field("session_type").getByRole("radio", { name: "Field" }));
    await fireEvent.press(field("rpe").getByRole("radio", { name: "5 · Hard" }));
    await fireEvent.changeText(screen.getByTestId("input-duration-minutes"), "60");
    expect(usePreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));

    await fireEvent.press(submitButton());

    expect(await screen.findByText("Thanks, Sam!")).toBeOnTheScreen();
    expect(app.callsTo("POST /orgs/org-1/me/submissions")[0]!.body).toEqual({
      form_id: "f1",
      values: { session_type: "field", rpe: 5, duration: 60 },
    });
    expect(screen.getByText("Session RPE saved for today.")).toBeOnTheScreen();
    expect(screen.getByText("300 AU")).toBeOnTheScreen();
    expect(screen.getByText("moderate")).toBeOnTheScreen();
    // Today's list is refetched after submitting.
    expect(app.callsTo("GET /orgs/org-1/me/forms").length).toBeGreaterThanOrEqual(2);
    expect(usePreventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));
  });

  it("maps server field errors (422) back to their fields", async () => {
    await renderApp(<QuestionnaireScreen formId="f1" />, {
      routes: routes({
        status: 422,
        body: { detail: { message: "invalid submission", field_errors: { session_type: "invalid_option" } } },
      }),
    });
    await answerRestDay();
    await fireEvent.press(submitButton());
    expect(await field("session_type").findByText("⚠ Choose one of the listed options.")).toBeOnTheScreen();
    expect(screen.getByText("Please check the highlighted answers.")).toBeOnTheScreen();
  });

  it("handles 409: already submitted today", async () => {
    await renderApp(<QuestionnaireScreen formId="f1" />, {
      routes: routes({ status: 409, body: { detail: "already submitted for 2026-10-12" } }),
    });
    await answerRestDay();
    await fireEvent.press(submitButton());
    expect(await screen.findByText("Already submitted today")).toBeOnTheScreen();
  });

  it("opens on the 'already submitted' state for a completed once-a-day form", async () => {
    const completed = { ...session, completed: true, last_submitted_at: "2026-10-12T07:00:00Z" };
    await renderApp(<QuestionnaireScreen formId="f1" />, { routes: routes({ status: 500 }, [completed]) });
    expect(await screen.findByText("Already submitted today")).toBeOnTheScreen();
  });

  it("keeps the answers after a network failure and retries", async () => {
    let offline = true;
    const app = await renderApp(<QuestionnaireScreen formId="f1" />, {
      routes: routes(() =>
        offline
          ? networkError()
          : { status: 201, body: makeSubmission("f1", { values: { session_type: "rest" }, computed: { srpe: 0 } }) },
      ),
    });
    await answerRestDay();
    await fireEvent.press(submitButton());

    expect(await screen.findByText(/Couldn't send your answers: no connection/)).toBeOnTheScreen();
    expect(field("session_type").getByRole("radio", { name: "Rest" })).toBeSelected();

    offline = false;
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Thanks, Sam!")).toBeOnTheScreen();
    expect(app.callsTo("POST /orgs/org-1/me/submissions")).toHaveLength(2);
    expect(app.callsTo("POST /orgs/org-1/me/submissions")[1]!.body).toEqual({
      form_id: "f1",
      values: { session_type: "rest" },
    });
  });

  it("does not submit when client validation fails", async () => {
    const app = await renderApp(<QuestionnaireScreen formId="f1" />, { routes: routes({ status: 500 }) });
    await screen.findByRole("header", { name: "Session" });
    await fireEvent.press(submitButton());
    expect(field("session_type").getByText("⚠ This field is required.")).toBeOnTheScreen();
    expect(app.callsTo("POST /orgs/org-1/me/submissions")).toHaveLength(0);
  });

  it("explains when the form is not available today", async () => {
    await renderApp(<QuestionnaireScreen formId="other" />, { routes: routes({ status: 500 }) });
    expect(await screen.findByText("Form not available")).toBeOnTheScreen();
  });
});
