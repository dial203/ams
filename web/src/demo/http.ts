/** Request/response plumbing shared by the demo backend's handlers. */
import { isFixtureError, type Maybe } from "./fixture";

export interface DemoRequest {
  method: string;
  /** Path below `/api/v1`, e.g. `/orgs/<id>/athletes`. */
  path: string;
  query: URLSearchParams;
  /** Parsed JSON body (undefined when none). */
  body: unknown;
  formData: FormData | null;
  headers: Record<string, string>;
}

export interface DemoResponse {
  status: number;
  /** JSON body; omitted for 204. */
  body?: unknown;
  /** Text body (CSV); takes precedence over `body`. */
  text?: string;
  contentType?: string;
}

/** Thrown by handlers; becomes a response with this status and body. */
export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(typeof body === "object" && body !== null && "detail" in body ? String((body as { detail: unknown }).detail) : `HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

/** `{detail}` error, the API's usual shape. */
export function fail(status: number, detail: unknown): HttpError {
  return new HttpError(status, { detail });
}

/** FastAPI's 422 for a request body that does not match the model. */
export function invalidBody(field: string, msg: string, type = "value_error"): HttpError {
  return new HttpError(422, { detail: [{ loc: ["body", field], msg, type }] });
}

export const NOT_IN_DEMO = "Not available in the demo";

export function json(body: unknown, status = 200): DemoResponse {
  return { status, body };
}

export function noContent(): DemoResponse {
  return { status: 204 };
}

/** The value, or the recorded API error re-thrown. */
export function replay<T>(value: Maybe<T> | undefined, missing = "not found"): T {
  if (value === undefined) throw fail(404, missing);
  if (isFixtureError(value)) throw new HttpError(value.$error.status, value.$error.body);
  return value;
}

/** The value, or `fallback` when the fixture recorded an error for it. */
export function orElse<T>(value: Maybe<T> | undefined, fallback: T): T {
  return value === undefined || isFixtureError(value) ? fallback : value;
}

// ---------------------------------------------------------------------------- body helpers

export function record(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(422, { detail: [{ loc: ["body"], msg: "Input should be a valid dictionary", type: "dict_type" }] });
  }
  return body as Record<string, unknown>;
}

export function requiredString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (v === undefined || v === null) throw invalidBody(key, "Field required", "missing");
  if (typeof v !== "string" || v.trim() === "") throw invalidBody(key, "String should have at least 1 character", "string_too_short");
  return v;
}

export function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

// ---------------------------------------------------------------------------- query helpers

export function queryInt(query: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  const raw = query.get(key);
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(422, {
      detail: [{ loc: ["query", key], msg: `Input should be between ${min} and ${max}`, type: "less_than_equal" }],
    });
  }
  return n;
}

export function queryBool(query: URLSearchParams, key: string): boolean {
  const v = query.get(key);
  return v === "true" || v === "1";
}

export function paginate<T>(items: readonly T[], query: URLSearchParams): { items: T[]; total: number } {
  const limit = queryInt(query, "limit", 50, 1, 500);
  const offset = queryInt(query, "offset", 0, 0, Number.MAX_SAFE_INTEGER);
  return { items: items.slice(offset, offset + limit), total: items.length };
}
