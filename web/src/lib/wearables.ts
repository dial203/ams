import { WEARABLE_PROVIDER_DEFAULT_ORDER, isApiError, type WearableMetric, type WearableProvider } from "@ams/shared";

export const WEARABLE_METRIC_LABELS: Record<WearableMetric, string> = {
  sleep_duration_min: "Sleep duration",
  sleep_efficiency_pct: "Sleep efficiency",
  sleep_deep_min: "Deep sleep",
  sleep_rem_min: "REM sleep",
  sleep_light_min: "Light sleep",
  sleep_awake_min: "Awake in bed",
  time_in_bed_min: "Time in bed",
  sleep_hrv_rmssd_ms: "Sleep HRV (RMSSD)",
  sleep_resting_hr_bpm: "Sleep resting HR",
  respiratory_rate: "Respiratory rate",
  hrv_rmssd_ms: "HRV (RMSSD)",
  resting_hr_bpm: "Resting HR",
  recovery_score: "Recovery score",
  steps: "Steps",
  active_energy_kcal: "Active energy",
  distance_m: "Distance",
  active_min: "Active minutes",
  moderate_min: "Moderate minutes",
  vigorous_min: "Vigorous minutes",
  weight_kg: "Body mass",
  body_fat_pct: "Body fat",
};

export function wearableMetricLabel(metric: string): string {
  return (WEARABLE_METRIC_LABELS as Record<string, string>)[metric] ?? metric.replace(/_/g, " ");
}

/** "3 h ago", "yesterday", "12 Oct" */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const s = Math.round((now - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The API answers 503 when Open Wearables is not configured. */
export function isNotConfigured(e: unknown): boolean {
  return isApiError(e) && e.status === 503;
}

/** Open Wearables' default provider order (appended after an organization's or athlete's own ranking). */
export const DEFAULT_PROVIDER_ORDER = WEARABLE_PROVIDER_DEFAULT_ORDER;

const PROVIDER_NAMES: Record<string, string> = {
  apple: "Apple Health",
  garmin: "Garmin",
  polar: "Polar",
  suunto: "Suunto",
  whoop: "WHOOP",
  fitbit: "Fitbit",
  google_health: "Google Health",
  health_connect: "Health Connect",
  oura: "Oura",
  samsung: "Samsung Health",
  sensorbio: "Sensorbio",
  strava: "Strava",
  ultrahuman: "Ultrahuman",
  withings: "Withings",
};

/** Display name of a provider key: Open Wearables' name when known, else a built-in one. */
export function providerLabel(key: string, providers?: readonly WearableProvider[]): string {
  return providers?.find((p) => p.provider === key)?.name ?? PROVIDER_NAMES[key] ?? key;
}
