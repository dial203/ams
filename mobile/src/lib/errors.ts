import { isApiError } from "@ams/shared";

/**
 * True when a request never got an HTTP response (offline, DNS, refused, timeout). The
 * shared client rethrows fetch's own error in that case, while every HTTP error is an
 * `ApiError`.
 */
export function isNetworkError(error: unknown): boolean {
  if (error === null || error === undefined || isApiError(error)) return false;
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /network|fetch|timed? ?out|offline|connection/i.test(message);
}

/** A short, human message for any error thrown by the API client. */
export function describeError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (isNetworkError(error)) return "Can't reach the server. Check your connection and try again.";
  if (isApiError(error)) {
    if (error.status >= 500) return "The server had a problem. Please try again in a moment.";
    if (error.status === 403) return error.detail || "You don't have access to this.";
    return error.detail || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * The Open Wearables-backed endpoints (`/me/wearables*`, sdk-token) answer 503 when the
 * organization's server has no Open Wearables configuration.
 */
export function isWearablesNotConfigured(error: unknown): boolean {
  return isApiError(error) && error.status === 503;
}
