/** API origin from `VITE_API_URL` (default http://localhost:8001); the client needs the `/api/v1` root. */
export function apiBaseUrl(origin: string | undefined = import.meta.env.VITE_API_URL as string | undefined): string {
  const base = (origin && origin.trim() !== "" ? origin.trim() : "http://localhost:8001").replace(/\/+$/, "");
  return /\/api\/v\d+$/.test(base) ? base : `${base}/api/v1`;
}
