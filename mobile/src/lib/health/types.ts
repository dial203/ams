/** Health-store sync (Apple Health / Health Connect / Samsung Health via Open Wearables). */

export type HealthUnavailableReason =
  /** `open-wearables` is not installed (the Metro/Jest stub is in use). */
  | "not-installed"
  /** The JS package is there but its native module is not (e.g. running in Expo Go). */
  | "native-module-missing"
  /** Not iOS or Android. */
  | "unsupported-platform";

export interface HealthProviderInfo {
  /** SDK provider id: `apple`, `google` (Health Connect) or `samsung`. */
  id: string;
  name: string;
  available: boolean;
}

export type HealthStatus =
  | { state: "unavailable"; reason: HealthUnavailableReason }
  | { state: "disconnected"; providers: HealthProviderInfo[] }
  | {
      state: "connected";
      /** Background sync is registered with the OS. */
      syncActive: boolean;
      /** A sync round is in flight right now. */
      syncing: boolean;
      /** The first full historical upload has finished. */
      initialExportDone: boolean;
      /** Records uploaded in the current session. */
      sentCount: number;
      /** SDK provider id in use. */
      provider: string | null;
      /** The SDK reported an auth error that could not be fixed with a new token. */
      authError: boolean;
    };

/**
 * App-facing interface over the Open Wearables SDK. Everything the UI does with health
 * stores goes through this; nothing else imports `open-wearables`.
 */
export interface HealthAdapter {
  /** False when the SDK or its native module is missing (stub / Expo Go / web). */
  isAvailable(): boolean;
  unavailableReason(): HealthUnavailableReason | null;
  /** Health stores the device offers (Android: Health Connect / Samsung Health; iOS: Apple Health). */
  providers(): HealthProviderInfo[];
  /**
   * Gets an SDK token for the athlete from AMS (`POST /orgs/{org}/me/wearables/sdk-token`),
   * signs the SDK in, asks for health permissions and starts background sync.
   */
  connect(orgId: string, options?: { provider?: string }): Promise<void>;
  /** Revokes the Open Wearables connection (when possible), stops sync and signs the SDK out. */
  disconnect(orgId?: string): Promise<void>;
  /** Stops sync and clears the SDK session on this device without revoking (used on logout). */
  signOutLocal(): Promise<void>;
  status(): HealthStatus;
  /** (Re)starts background sync for a signed-in SDK session. */
  startSync(): Promise<boolean>;
  /**
   * Call once at startup: re-applies the stored Open Wearables host, subscribes to
   * `onAuthError` (fetch a new SDK token from AMS, then `updateTokens`) and restores which
   * org the SDK session was connected from.
   */
  restore(): Promise<void>;
  /** Org the SDK session was connected from (tokens are per athlete, so per org). */
  connectedOrgId(): string | null;
  /** Notified after connect/disconnect/auth problems. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export class HealthUnavailableError extends Error {
  readonly reason: HealthUnavailableReason;
  constructor(reason: HealthUnavailableReason) {
    super("Health sync needs the development build.");
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "HealthUnavailableError";
    this.reason = reason;
  }
}

export class HealthConnectError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "HealthConnectError";
  }
}
