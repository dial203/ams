import * as Notifications from "expo-notifications";
import { disablePush, enablePush, PushError, refreshPushRegistration } from "../push";
import { memoryStorage, STORAGE_KEYS } from "../storage";
import { createFetchMock } from "../../test/fetchMock";
import { createTestApi } from "../../test/renderApp";

jest.mock("../config", () => ({ ...jest.requireActual("../config"), easProjectId: () => "eas-project" }));

describe("push token registration", () => {
  it("registers the Expo push token with POST /me/push-tokens and remembers it", async () => {
    const mock = createFetchMock({ "POST /me/push-tokens": { status: 204 } });
    const storage = memoryStorage();
    await expect(enablePush(createTestApi(mock.fetch), storage)).resolves.toBe("ExponentPushToken[test]");
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "eas-project" });
    expect(mock.callsTo("POST /me/push-tokens")[0]!.body).toEqual({ token: "ExponentPushToken[test]", platform: "ios" });
    expect(storage.data.get(STORAGE_KEYS.pushToken)).toBe("ExponentPushToken[test]");
  });

  it("explains a denied permission", async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: "denied" });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: "denied" });
    const mock = createFetchMock();
    const error = await enablePush(createTestApi(mock.fetch), memoryStorage()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PushError);
    expect(mock.calls).toHaveLength(0);
  });

  it("removes the token with DELETE /me/push-tokens/{token} (404 is fine)", async () => {
    const mock = createFetchMock({ "DELETE /me/push-tokens/ExponentPushToken[test]": { status: 404, body: { detail: "x" } } });
    const storage = memoryStorage({ [STORAGE_KEYS.pushToken]: "ExponentPushToken[test]" });
    await disablePush(createTestApi(mock.fetch), storage);
    expect(mock.calls).toHaveLength(1);
    expect(storage.data.has(STORAGE_KEYS.pushToken)).toBe(false);
  });

  it("re-sends a remembered token after login", async () => {
    const mock = createFetchMock({ "POST /me/push-tokens": { status: 204 } });
    await refreshPushRegistration(createTestApi(mock.fetch), memoryStorage({ [STORAGE_KEYS.pushToken]: "tok" }));
    expect(mock.callsTo("POST /me/push-tokens")[0]!.body).toEqual({ token: "tok", platform: "ios" });
    await refreshPushRegistration(createTestApi(mock.fetch), memoryStorage());
    expect(mock.calls).toHaveLength(1);
  });
});
