import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * App config. Environment:
 *   EXPO_PUBLIC_API_URL  AMS API, e.g. http://192.168.1.20:8001 (`/api/v1` is appended when missing)
 *   EAS_PROJECT_ID       EAS project id, needed for Expo push tokens
 *   AMS_IOS_BUNDLE_ID / AMS_ANDROID_PACKAGE  native identifiers (dev builds)
 */

/** Whether a package is installed (resolvable from this project). */
function isInstalled(name: string): boolean {
  try {
    require.resolve(`${name}/package.json`, { paths: [__dirname] });
    return true;
  } catch {
    return false;
  }
}

/**
 * The Open Wearables React Native SDK is not on npm yet; see README.md. Its config plugin
 * (HealthKit entitlements, Health Connect activity aliases) is only added when the package is
 * present, so `expo config` / `expo prebuild` keep working without it.
 */
const HEALTH_SDK_INSTALLED = isInstalled("open-wearables");

const HEALTH_SHARE_USAGE =
  "AMS reads your sleep, heart rate, HRV, activity and workouts to share them with your team's monitoring.";
const HEALTH_UPDATE_USAGE = "AMS does not write health data; this permission is required by the health SDK.";

export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins: NonNullable<ExpoConfig["plugins"]> = [
    "expo-router",
    "expo-secure-store",
    "expo-web-browser",
    ["expo-notifications", { color: "#1F6FEB" }],
  ];
  if (HEALTH_SDK_INSTALLED) {
    plugins.push([
      "open-wearables",
      { healthShareUsage: HEALTH_SHARE_USAGE, healthUpdateUsage: HEALTH_UPDATE_USAGE },
    ]);
    plugins.push(["expo-build-properties", { android: { minSdkVersion: 29 } }]);
  }

  const projectId = process.env.EAS_PROJECT_ID;
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;

  return {
    ...config,
    name: "AMS",
    slug: "ams-athlete",
    scheme: "ams",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    backgroundColor: "#F6F7F9",
    ios: {
      ...config.ios,
      bundleIdentifier: process.env.AMS_IOS_BUNDLE_ID ?? "org.ams.athlete",
      supportsTablet: true,
    },
    android: {
      ...config.android,
      package: process.env.AMS_ANDROID_PACKAGE ?? "org.ams.athlete",
    },
    plugins,
    experiments: {
      typedRoutes: true,
    },
    extra: {
      ...config.extra,
      ...(apiUrl ? { apiUrl } : {}),
      healthSdkInstalled: HEALTH_SDK_INSTALLED,
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
};
