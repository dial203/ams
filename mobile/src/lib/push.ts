import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { isApiError, type ApiClient, type PushPlatform } from "@ams/shared";
import { easProjectId } from "./config";
import { STORAGE_KEYS, type KeyValueStorage } from "./storage";

export class PushError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "PushError";
  }
}

export function pushPlatform(): PushPlatform | null {
  return Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;
}

/** Asks for permission (if needed) and returns this device's Expo push token. */
export async function obtainExpoPushToken(): Promise<string> {
  if (!pushPlatform()) throw new PushError("Notifications are only available on iOS and Android.");
  if (!Device.isDevice) throw new PushError("Notifications need a physical device, not a simulator.");
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== "granted") {
    throw new PushError("Notifications are turned off for AMS. You can allow them in Settings.");
  }
  const projectId = easProjectId();
  if (!projectId) {
    throw new PushError("This build has no EAS project id (EAS_PROJECT_ID), so it can't receive push notifications.");
  }
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch {
    throw new PushError(
      "Couldn't get a push token. On Android, notifications need the development build (not Expo Go).",
    );
  }
}

export async function getRegisteredPushToken(storage: KeyValueStorage): Promise<string | null> {
  try {
    return await storage.getItem(STORAGE_KEYS.pushToken);
  } catch {
    return null;
  }
}

/** `POST /me/push-tokens` with this device's token and remembers it. */
export async function enablePush(api: Pick<ApiClient, "me">, storage: KeyValueStorage): Promise<string> {
  const platform = pushPlatform();
  if (!platform) throw new PushError("Notifications are only available on iOS and Android.");
  const token = await obtainExpoPushToken();
  await api.me.registerPushToken({ token, platform });
  await storage.setItem(STORAGE_KEYS.pushToken, token);
  return token;
}

/** `DELETE /me/push-tokens/{token}` for the remembered token, then forgets it. */
export async function disablePush(api: Pick<ApiClient, "me">, storage: KeyValueStorage): Promise<void> {
  const token = await getRegisteredPushToken(storage);
  if (token) {
    try {
      await api.me.deletePushToken(token);
    } catch (error) {
      if (!(isApiError(error) && error.status === 404)) throw error;
    }
  }
  await storage.removeItem(STORAGE_KEYS.pushToken);
}

/** Re-sends a remembered token (upsert) so the server stays in sync after a new login. */
export async function refreshPushRegistration(api: Pick<ApiClient, "me">, storage: KeyValueStorage): Promise<void> {
  const token = await getRegisteredPushToken(storage);
  const platform = pushPlatform();
  if (!token || !platform) return;
  await api.me.registerPushToken({ token, platform });
}
