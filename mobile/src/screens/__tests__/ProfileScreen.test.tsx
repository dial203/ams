import { Alert } from "react-native";
import { fireEvent, screen } from "@testing-library/react-native";
import { athlete, me } from "../../test/fixtures";
import type { MockHandler } from "../../test/fetchMock";
import { renderApp } from "../../test/renderApp";
import { ProfileScreen } from "../ProfileScreen";

function routes(extra: Record<string, MockHandler> = {}): Record<string, MockHandler> {
  return {
    "GET /me": { body: me },
    "GET /orgs/org-1/me/athlete": { body: athlete },
    ...extra,
  };
}

describe("ProfileScreen", () => {
  it("shows name, email, organization and code in the org's terminology", async () => {
    await renderApp(<ProfileScreen />, { routes: routes() });
    expect(await screen.findByText("Sam Lee")).toBeOnTheScreen();
    expect(screen.getByText("sam@example.org")).toBeOnTheScreen();
    expect(screen.getByText("Riverside Rowing")).toBeOnTheScreen();
    expect(await screen.findByText("Rower code")).toBeOnTheScreen();
    expect(screen.getByText("R-014")).toBeOnTheScreen();
  });

  it("changes the password with PATCH /me and explains a wrong current password", async () => {
    let attempt = 0;
    const app = await renderApp(<ProfileScreen />, {
      routes: routes({
        "PATCH /me": () =>
          ++attempt === 1 ? { status: 403, body: { detail: "current_password is incorrect" } } : { body: me.user },
      }),
    });
    await screen.findByText("Sam Lee");
    await fireEvent.changeText(screen.getByLabelText("Current password"), "old-password");
    await fireEvent.changeText(screen.getByLabelText("New password"), "new-password-1");
    await fireEvent.changeText(screen.getByLabelText("Confirm new password"), "new-password-1");
    await fireEvent.press(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Your current password is incorrect.")).toBeOnTheScreen();
    expect(app.callsTo("PATCH /me")[0]!.body).toEqual({ password: "new-password-1", current_password: "old-password" });

    await fireEvent.press(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Password changed.")).toBeOnTheScreen();
  });

  it("explains why reminders can't be enabled in this build", async () => {
    await renderApp(<ProfileScreen />, { routes: routes() });
    await screen.findByText("Sam Lee");
    await fireEvent(screen.getByLabelText("Questionnaire reminders"), "valueChange", true);
    expect(await screen.findByText(/no EAS project id/)).toBeOnTheScreen();
  });

  it("asks before signing out", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === "destructive")?.onPress?.();
    });
    const app = await renderApp(<ProfileScreen />, { routes: routes() });
    await screen.findByText("Sam Lee");
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    expect(alert).toHaveBeenCalled();
    expect(app.session.signOut).toHaveBeenCalled();
  });
});
