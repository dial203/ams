import Constants from "expo-constants";

/** Port the AMS API listens on in the local docker compose stack (docker-compose.yml). */
export const DEV_API_PORT = 8001;

/** Ensures the URL ends with the API version prefix the shared client expects. */
export function normalizeApiUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, "");
  return /\/api\/v\d+$/.test(url) ? url : `${url}/api/v1`;
}

/** `http://<metro host>:8001` while running from a dev server, so a LAN IP just works. */
export function apiUrlFromHostUri(hostUri: string | null | undefined, port = DEV_API_PORT): string | null {
  if (!hostUri) return null;
  const host = hostUri.replace(/^[a-z]+:\/\//i, "").split("/")[0]?.split(":")[0];
  return host ? `http://${host}:${port}` : null;
}

/**
 * Resolution order: `EXPO_PUBLIC_API_URL` (inlined at build time), `extra.apiUrl` from
 * app.config.ts, then the dev server's host on port 8001, then localhost.
 */
export function resolveApiUrl(
  envUrl: string | undefined,
  extraUrl: unknown,
  hostUri: string | null | undefined,
): string {
  if (envUrl && envUrl.trim() !== "") return normalizeApiUrl(envUrl);
  if (typeof extraUrl === "string" && extraUrl.trim() !== "") return normalizeApiUrl(extraUrl);
  const fromHost = apiUrlFromHostUri(hostUri);
  if (fromHost) return normalizeApiUrl(fromHost);
  return normalizeApiUrl(`http://localhost:${DEV_API_PORT}`);
}

export const API_URL = resolveApiUrl(
  process.env.EXPO_PUBLIC_API_URL,
  Constants.expoConfig?.extra?.apiUrl,
  Constants.expoConfig?.hostUri,
);

export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

/** EAS project id for Expo push tokens (app.config.ts `extra.eas.projectId`). */
export function easProjectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra?.eas as { projectId?: unknown } | undefined)?.projectId;
  if (typeof fromExtra === "string" && fromExtra !== "") return fromExtra;
  const fromEas = (Constants as { easConfig?: { projectId?: unknown } | null }).easConfig?.projectId;
  return typeof fromEas === "string" && fromEas !== "" ? fromEas : null;
}

/** Minimum password length the app asks for (client-side hint; the API enforces its own rules). */
export const MIN_PASSWORD_LENGTH = 8;

/** "192.168.1.20:8001" for display. */
export function serverHost(url: string = API_URL): string {
  return url.replace(/^https?:\/\//, "").replace(/\/api\/v\d+$/, "");
}
