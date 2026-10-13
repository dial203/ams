/**
 * API origin from `VITE_API_URL` (default http://localhost:8001); the client needs the `/api/v1` root.
 * `/` means same origin: the web server forwards `/api` to the API (the Docker image's nginx does).
 */
export function apiBaseUrl(origin: string | undefined = import.meta.env.VITE_API_URL as string | undefined): string {
  const raw = origin?.trim() ?? "";
  if (raw === "/") return "/api/v1";
  const base = (raw !== "" ? raw : "http://localhost:8001").replace(/\/+$/, "");
  return /\/api\/v\d+$/.test(base) ? base : `${base}/api/v1`;
}
