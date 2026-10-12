/**
 * Stand-in for the Open Wearables React Native SDK (`open-wearables`) while the real package
 * is not installed (it is not on npm yet; see README.md). Metro (metro.config.js) and Jest
 * (jest.config.js) resolve `open-wearables` to this file in that case.
 *
 * It mirrors the SDK's API so the app compiles and runs, reports itself as unavailable, and
 * makes every call that would need the native module fail loudly.
 */
import type OpenWearablesHealthSDKType from "open-wearables";

type SdkModule = typeof OpenWearablesHealthSDKType;

/** Marks this module as the stub. The real SDK has no such export. */
export const __AMS_STUB__ = true;

/** Always false: health-store sync needs a development build with the real SDK. */
export function isAvailable(): boolean {
  return false;
}

export const OWLogLevel = { None: 0, Always: 1, Debug: 2 } as const;

export const HealthDataType = {
  Steps: "steps",
  DistanceWalkingRunning: "distanceWalkingRunning",
  ActiveEnergy: "activeEnergy",
  BasalEnergy: "basalEnergy",
  HeartRate: "heartRate",
  RestingHeartRate: "restingHeartRate",
  HeartRateVariabilitySDNN: "heartRateVariabilitySDNN",
  Vo2Max: "vo2Max",
  OxygenSaturation: "oxygenSaturation",
  RespiratoryRate: "respiratoryRate",
  BodyMass: "bodyMass",
  BodyFatPercentage: "bodyFatPercentage",
  Sleep: "sleep",
  Workout: "workout",
} as const;

export const STUB_MESSAGE =
  "Open Wearables SDK is not installed in this build (stub). Health sync needs the development build.";

function unavailable(): never {
  throw new Error(STUB_MESSAGE);
}

const OpenWearablesHealthSDK: SdkModule = {
  configure: () => unavailable(),
  signIn: async () => unavailable(),
  signOut: async () => undefined,
  updateTokens: () => unavailable(),
  restoreSession: () => null,
  isSessionValid: () => false,
  requestAuthorization: async () => unavailable(),
  setSyncInterval: () => undefined,
  startBackgroundSync: async () => false,
  stopBackgroundSync: async () => undefined,
  isSyncActive: () => false,
  getSyncStatus: () => ({
    hasResumableSession: false,
    sentCount: 0,
    completedTypes: 0,
    isFullExport: false,
    initialExportDone: false,
    isSyncing: false,
    createdAt: null,
  }),
  resumeSync: async () => false,
  resetAnchors: () => undefined,
  getStoredCredentials: () => ({
    userId: null,
    accessToken: null,
    refreshToken: null,
    apiKey: null,
    host: null,
    customSyncUrl: null,
    isSyncActive: false,
    provider: null,
  }),
  getAvailableProviders: () => [],
  setProvider: () => false,
  setLogLevel: () => undefined,
  getLogLevel: () => 0,
  addListener: () => ({ remove: () => undefined }),
};

export default OpenWearablesHealthSDK;
