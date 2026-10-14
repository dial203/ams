import { fireEvent, screen } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import type { WearableStatus } from "@ams/shared";
import { emptyWearables, providers } from "../../test/fixtures";
import { mockRouter } from "../../test/expoRouterMock";
import type { MockHandler } from "../../test/fetchMock";
import { renderApp } from "../../test/renderApp";
import { ConnectDeviceScreen } from "../ConnectDeviceScreen";
import { DevicesScreen } from "../DevicesScreen";

const openAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock;

const garminConnected: WearableStatus = {
  ...emptyWearables,
  sources: ["garmin"],
  connections: [
    {
      connection_id: "c1",
      provider: "garmin",
      status: "active",
      account_type: null,
      account_label: "Forerunner",
      last_synced_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
      created_at: "2026-10-01T00:00:00Z",
      devices: ["Garmin Forerunner 965"],
    },
  ],
};

function routes(status: MockHandler, extra: Record<string, MockHandler> = {}): Record<string, MockHandler> {
  return {
    "GET /orgs/org-1/me/wearables": status,
    "GET /orgs/org-1/me/wearables/providers": { body: providers },
    ...extra,
  };
}

describe("DevicesScreen", () => {
  it("lists connections with status, last sync and devices", async () => {
    await renderApp(<DevicesScreen />, { routes: routes({ body: garminConnected }) });
    expect(await screen.findByText("Garmin")).toBeOnTheScreen();
    expect(screen.getByText("Connected")).toBeOnTheScreen();
    expect(screen.getByText("Forerunner")).toBeOnTheScreen();
    expect(screen.getByText("Last synced 3 h ago")).toBeOnTheScreen();
    expect(screen.getByText("Devices: Garmin Forerunner 965")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Connect a device" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/connect-device");
  });

  it("explains that health-store sync needs the development build (SDK stub)", async () => {
    await renderApp(<DevicesScreen />, { routes: routes({ body: emptyWearables }) });
    expect(await screen.findByText("No devices connected")).toBeOnTheScreen();
    expect(screen.getByText("Apple Health")).toBeOnTheScreen();
    expect(screen.getByText("Health sync needs the development build")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Connect Apple Health/ })).not.toBeOnTheScreen();
  });

  it("shows a friendly state when the organization has not set up wearables (503)", async () => {
    await renderApp(<DevicesScreen />, {
      routes: routes({ status: 503, body: { detail: "Open Wearables is not configured" } }),
    });
    expect(await screen.findByText("Wearables aren't set up by your organization yet")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Connect a device" })).not.toBeOnTheScreen();
  });
});

describe("ConnectDeviceScreen", () => {
  it("offers enabled cloud providers only", async () => {
    await renderApp(<ConnectDeviceScreen />, { routes: routes({ body: emptyWearables }) });
    expect(await screen.findByText("Garmin")).toBeOnTheScreen();
    expect(screen.getByText("Oura")).toBeOnTheScreen();
    expect(screen.queryByText("Whoop")).not.toBeOnTheScreen();
    expect(screen.queryByText("Apple Health")).not.toBeOnTheScreen();
  });

  it("gets the authorization URL, opens an auth session to the deep link, then refreshes the status", async () => {
    let connected = false;
    openAuthSession.mockImplementationOnce(async () => {
      connected = true;
      return { type: "success", url: "ams://wearables/connected?provider=garmin" };
    });
    const app = await renderApp(<ConnectDeviceScreen />, {
      routes: routes(() => ({ body: connected ? garminConnected : emptyWearables }), {
        "POST /orgs/org-1/me/wearables/connect": { body: { authorization_url: "https://connect.garmin.test/oauth?state=x" } },
      }),
    });
    await fireEvent.press(await screen.findByRole("button", { name: "Connect Garmin" }));

    expect(await screen.findByText("Garmin is connected. Data appears after its first sync.")).toBeOnTheScreen();
    expect(app.callsTo("POST /orgs/org-1/me/wearables/connect")[0]!.body).toEqual({
      provider: "garmin",
      redirect_uri: "ams://wearables/connected",
    });
    expect(openAuthSession).toHaveBeenCalledWith("https://connect.garmin.test/oauth?state=x", "ams://wearables/connected");
    expect(app.callsTo("GET /orgs/org-1/me/wearables").length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByRole("button", { name: "Add another account for Garmin" })).toBeOnTheScreen();
  });

  it("reports a cancelled auth session", async () => {
    openAuthSession.mockResolvedValueOnce({ type: "cancel" });
    await renderApp(<ConnectDeviceScreen />, {
      routes: routes({ body: emptyWearables }, {
        "POST /orgs/org-1/me/wearables/connect": { body: { authorization_url: "https://oura.test/auth" } },
      }),
    });
    await fireEvent.press(await screen.findByRole("button", { name: "Connect Oura" }));
    expect(await screen.findByText("Oura wasn't connected. You can try again.")).toBeOnTheScreen();
  });

  it("asks for a new account when the provider is already connected", async () => {
    openAuthSession.mockResolvedValueOnce({ type: "dismiss" });
    const app = await renderApp(<ConnectDeviceScreen />, {
      routes: routes({ body: garminConnected }, {
        "POST /orgs/org-1/me/wearables/connect": { body: { authorization_url: "https://connect.garmin.test/oauth" } },
      }),
    });
    await fireEvent.press(await screen.findByRole("button", { name: "Add another account for Garmin" }));
    await screen.findByText("Garmin is connected. Data appears after its first sync.");
    expect(app.callsTo("POST /orgs/org-1/me/wearables/connect")[0]!.body).toEqual({
      provider: "garmin",
      redirect_uri: "ams://wearables/connected",
      new_account: true,
    });
  });

  it("shows the API's error when the connect call fails", async () => {
    await renderApp(<ConnectDeviceScreen />, {
      routes: routes({ body: emptyWearables }, {
        "POST /orgs/org-1/me/wearables/connect": { status: 400, body: { detail: "Provider garmin is disabled" } },
      }),
    });
    await fireEvent.press(await screen.findByRole("button", { name: "Connect Garmin" }));
    expect(await screen.findByText("Provider garmin is disabled")).toBeOnTheScreen();
    expect(openAuthSession).not.toHaveBeenCalled();
  });
});
