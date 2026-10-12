/**
 * Type declaration for the Open Wearables React Native SDK (`open-wearables`, default export
 * `OpenWearablesHealthSDK`), mirroring
 * https://github.com/the-momentum/open-wearables-react-native-sdk/blob/main/src (v0.2.0).
 *
 * The package is not on npm yet. TypeScript only uses this ambient declaration when the real
 * package cannot be resolved; once it is installed, its own types take over. Metro and Jest
 * map the module to `src/lib/health/ow-sdk-stub.ts` while it is missing.
 */
declare module "open-wearables" {
  export type LogEventPayload = { message: string };
  export type AuthErrorEventPayload = { statusCode: number; message: string };

  export type OpenWearablesModuleEvents = {
    onLog: (params: LogEventPayload) => void;
    onAuthError: (params: AuthErrorEventPayload) => void;
  };

  export enum OWLogLevel {
    None = 0,
    Always = 1,
    Debug = 2,
  }

  export enum HealthDataType {
    Steps = "steps",
    DistanceWalkingRunning = "distanceWalkingRunning",
    ActiveEnergy = "activeEnergy",
    BasalEnergy = "basalEnergy",
    HeartRate = "heartRate",
    RestingHeartRate = "restingHeartRate",
    HeartRateVariabilitySDNN = "heartRateVariabilitySDNN",
    Vo2Max = "vo2Max",
    OxygenSaturation = "oxygenSaturation",
    RespiratoryRate = "respiratoryRate",
    BodyMass = "bodyMass",
    BodyFatPercentage = "bodyFatPercentage",
    Sleep = "sleep",
    Workout = "workout",
  }

  export type HealthDataProvider = { id: string; displayName: string; isAvailable: boolean };

  export type StoredCredentials = {
    userId: string | null;
    accessToken: string | null;
    refreshToken: string | null;
    apiKey: string | null;
    host: string | null;
    customSyncUrl: string | null;
    isSyncActive: boolean;
    provider: string | null;
  };

  export type SyncStatus = {
    hasResumableSession: boolean;
    sentCount: number;
    completedTypes: number;
    isFullExport: boolean;
    initialExportDone: boolean;
    isSyncing: boolean;
    createdAt: string | null;
  };

  export interface EventSubscription {
    remove(): void;
  }

  interface OpenWearablesModule {
    configure(host: string, customSyncURL?: string): void;
    signIn(userId: string, accessToken: string | null, refreshToken: string | null, apiKey: string | null): Promise<void>;
    signOut(): Promise<void>;
    updateTokens(accessToken: string, refreshToken: string | null): void;
    restoreSession(): string | null;
    isSessionValid(): boolean;
    requestAuthorization(types: HealthDataType[]): Promise<boolean>;
    setSyncInterval(minutes: number): void;
    startBackgroundSync(syncDaysBack: number | null): Promise<boolean>;
    stopBackgroundSync(): Promise<void>;
    isSyncActive(): boolean;
    getSyncStatus(): SyncStatus;
    resumeSync(): Promise<boolean>;
    resetAnchors(): void;
    getStoredCredentials(): StoredCredentials;
    getAvailableProviders(): HealthDataProvider[];
    setProvider(providerId: string): boolean;
    setLogLevel(logLevel: OWLogLevel): void;
    getLogLevel(): OWLogLevel;
    addListener<E extends keyof OpenWearablesModuleEvents>(
      eventName: E,
      listener: OpenWearablesModuleEvents[E],
    ): EventSubscription;
  }

  const OpenWearablesHealthSDK: OpenWearablesModule;
  export default OpenWearablesHealthSDK;
}
