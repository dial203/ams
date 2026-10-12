import type OpenWearablesHealthSDK from "open-wearables";
import type { HealthUnavailableReason } from "./types";

/** The SDK's default export (`OpenWearablesHealthSDK`). */
export type OpenWearablesSdk = typeof OpenWearablesHealthSDK;

export type SdkLoadResult =
  | { ok: true; sdk: OpenWearablesSdk }
  | { ok: false; reason: HealthUnavailableReason; error?: unknown };

interface SdkModuleShape {
  default?: OpenWearablesSdk;
  /** Only the stub exports this. */
  isAvailable?: () => boolean;
}

/**
 * Loads `open-wearables` lazily. The real package calls `requireNativeModule` at import
 * time, which throws when the native module is not in the binary (Expo Go), so the import
 * cannot be a static one.
 */
export function loadOpenWearablesSdk(): SdkLoadResult {
  let mod: SdkModuleShape;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("open-wearables") as SdkModuleShape;
  } catch (error) {
    return { ok: false, reason: "native-module-missing", error };
  }
  if (typeof mod.isAvailable === "function" && !mod.isAvailable()) {
    return { ok: false, reason: "not-installed" };
  }
  const sdk = mod.default;
  if (!sdk || typeof sdk.configure !== "function") return { ok: false, reason: "native-module-missing" };
  return { ok: true, sdk };
}
