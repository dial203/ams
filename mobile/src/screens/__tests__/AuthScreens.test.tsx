import { fireEvent, screen } from "@testing-library/react-native";
import { ApiError } from "@ams/shared";
import { mockRouter, setMockParams } from "../../test/expoRouterMock";
import { renderApp } from "../../test/renderApp";
import { AcceptInviteScreen, extractInviteToken } from "../AcceptInviteScreen";
import { LoginScreen } from "../LoginScreen";

describe("LoginScreen", () => {
  it("signs in with the entered credentials", async () => {
    const app = await renderApp(<LoginScreen />, { membership: null, session: { status: "signedOut" } });
    await fireEvent.changeText(screen.getByLabelText("Email"), "sam@example.org");
    await fireEvent.changeText(screen.getByLabelText("Password"), "secret-pass");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(app.session.signIn).toHaveBeenCalledWith("sam@example.org", "secret-pass");
  });

  it("explains a 401 and a missing password", async () => {
    await renderApp(<LoginScreen />, {
      membership: null,
      session: {
        status: "signedOut",
        signIn: jest.fn(async () => {
          throw new ApiError({ status: 401, detail: "invalid credentials" });
        }),
      },
    });
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email and password.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Email"), "sam@example.org");
    await fireEvent.changeText(screen.getByLabelText("Password"), "wrong");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Email or password is incorrect.")).toBeOnTheScreen();
  });

  it("tells the athlete when the session expired", async () => {
    await renderApp(<LoginScreen />, { membership: null, session: { status: "signedOut", expired: true } });
    expect(screen.getByText("Your session has expired. Please sign in again.")).toBeOnTheScreen();
  });
});

describe("AcceptInviteScreen", () => {
  afterEach(() => setMockParams({}));

  it("loads the invitation from the deep link token and creates the account", async () => {
    setMockParams({ token: "tok-123" });
    const app = await renderApp(<AcceptInviteScreen />, {
      membership: null,
      session: { status: "signedOut" },
      routes: {
        "GET /auth/invite/tok-123": {
          body: { email: "sam@example.org", org_name: "Riverside Rowing", role: "athlete", expires_at: "2026-10-20T00:00:00Z" },
        },
      },
    });
    expect(await screen.findByText("Join Riverside Rowing")).toBeOnTheScreen();
    expect(screen.getByText("sam@example.org")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText("Your name"), "Sam Lee");
    await fireEvent.changeText(screen.getByLabelText("Password"), "short");
    await fireEvent.press(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Use at least 8 characters.")).toBeOnTheScreen();
    expect(app.session.acceptInvite).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText("Password"), "long-enough");
    await fireEvent.changeText(screen.getByLabelText("Confirm password"), "long-enough");
    await fireEvent.press(screen.getByRole("button", { name: "Create account" }));
    expect(app.session.acceptInvite).toHaveBeenCalledWith({ token: "tok-123", password: "long-enough", full_name: "Sam Lee" });
    expect(await screen.findByText("You're in")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(mockRouter.replace).toHaveBeenCalledWith("/");
  });

  it("explains an expired invitation", async () => {
    setMockParams({ token: "old" });
    await renderApp(<AcceptInviteScreen />, {
      membership: null,
      session: { status: "signedOut" },
      routes: { "GET /auth/invite/old": { status: 404, body: { detail: "invitation not found" } } },
    });
    expect(await screen.findByText(/invalid or has expired/)).toBeOnTheScreen();
  });

  it("accepts a pasted link when opened without a token", async () => {
    const app = await renderApp(<AcceptInviteScreen />, {
      membership: null,
      session: { status: "signedOut" },
      routes: {
        "GET /auth/invite/abc": {
          body: { email: "sam@example.org", org_name: "Riverside Rowing", role: "athlete", expires_at: "2026-10-20T00:00:00Z" },
        },
      },
    });
    await fireEvent.changeText(screen.getByLabelText("Invitation link or code"), "https://ams.example.org/accept-invite?token=abc");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Join Riverside Rowing")).toBeOnTheScreen();
    expect(app.callsTo("GET /auth/invite/abc")).toHaveLength(1);
  });
});

describe("extractInviteToken", () => {
  it("reads tokens from deep links, web links and bare codes", () => {
    expect(extractInviteToken("ams://accept-invite?token=a%2Bb")).toBe("a+b");
    expect(extractInviteToken("https://x.org/accept-invite?foo=1&token=xyz#top")).toBe("xyz");
    expect(extractInviteToken("  raw-token ")).toBe("raw-token");
  });
});
