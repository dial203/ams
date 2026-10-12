import { isApiError } from "@ams/shared";
import { toast } from "sonner";

/** A short human-readable message for any thrown value. */
export function errorText(e: unknown, fallback = "Something went wrong."): string {
  if (isApiError(e)) {
    if (e.status === 0) return "Could not reach the server.";
    return e.detail || fallback;
  }
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) return "Could not reach the server.";
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

export function toastError(e: unknown, title?: string): void {
  const message = errorText(e);
  if (title) toast.error(title, { description: message });
  else toast.error(message);
}

export function isStatus(e: unknown, status: number): boolean {
  return isApiError(e) && e.status === status;
}
