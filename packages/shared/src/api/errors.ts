import type { SchemaError } from "../forms/types";
import { isRecord } from "../util";

/** One item of FastAPI's default 422 body (`{detail: [...]}`). */
export interface ValidationErrorItem {
  loc: (string | number)[];
  msg: string;
  type: string;
  [extra: string]: unknown;
}

export interface ApiErrorInit {
  status: number;
  detail: string;
  fieldErrors?: Record<string, string> | undefined;
  schemaErrors?: SchemaError[] | undefined;
  validationErrors?: ValidationErrorItem[] | undefined;
  body?: unknown;
}

/**
 * A non-2xx response. `detail` is always a human-readable string:
 * - `{detail: string}` -> that string
 * - submission 422 `{detail: {message, field_errors}}` -> `message`, plus `fieldErrors`
 * - publish 422 `{detail: {message, schema_errors}}` -> `message`, plus `schemaErrors`
 * - FastAPI 422 `{detail: [{loc, msg, type}]}` -> messages joined, plus `validationErrors`
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  /** Submission validation: field key -> error code (see `ErrorCode`). */
  readonly fieldErrors?: Record<string, string>;
  /** Publish validation errors. */
  readonly schemaErrors?: SchemaError[];
  /** FastAPI request-validation errors. */
  readonly validationErrors?: ValidationErrorItem[];
  /** Parsed JSON body (or text) as received. */
  readonly body: unknown;

  constructor(init: ApiErrorInit) {
    super(init.detail);
    // Keep `instanceof` working when the class is down-levelled (e.g. Babel in Metro).
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "ApiError";
    this.status = init.status;
    this.detail = init.detail;
    this.body = init.body;
    if (init.fieldErrors) this.fieldErrors = init.fieldErrors;
    if (init.schemaErrors) this.schemaErrors = init.schemaErrors;
    if (init.validationErrors) this.validationErrors = init.validationErrors;
  }
}

/** `instanceof ApiError` that also works across duplicated module instances. */
export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError || (isRecord(e) && e.name === "ApiError" && typeof e.status === "number");
}

function stringRecord(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const k of Object.keys(v)) out[k] = String(v[k]);
  return out;
}

function schemaErrorList(v: unknown): SchemaError[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter(isRecord)
    .map((e) => ({ path: String(e.path ?? ""), message: String(e.message ?? "") }));
}

function validationItems(v: unknown[]): ValidationErrorItem[] {
  return v.filter(isRecord).map((e) => ({
    ...e,
    loc: Array.isArray(e.loc) ? (e.loc as (string | number)[]) : [],
    msg: String(e.msg ?? ""),
    type: String(e.type ?? ""),
  }));
}

/** Location of a FastAPI validation error without the leading `body`/`query`/`path`. */
export function validationErrorField(item: ValidationErrorItem): string {
  const loc = item.loc.slice();
  if (loc[0] === "body" || loc[0] === "query" || loc[0] === "path" || loc[0] === "header") loc.shift();
  return loc.join(".");
}

/** Builds an `ApiError` from a status and a response body (JSON-parsed when possible). */
export function apiErrorFromBody(status: number, body: unknown, statusText = ""): ApiError {
  const fallback = statusText || `Request failed with status ${status}`;
  if (isRecord(body) && "detail" in body) {
    const d = body.detail;
    if (typeof d === "string") return new ApiError({ status, detail: d, body });
    if (Array.isArray(d)) {
      const items = validationItems(d);
      const text = items
        .map((i) => {
          const field = validationErrorField(i);
          return field ? `${field}: ${i.msg}` : i.msg;
        })
        .join("; ");
      return new ApiError({ status, detail: text || fallback, validationErrors: items, body });
    }
    if (isRecord(d)) {
      return new ApiError({
        status,
        detail: typeof d.message === "string" ? d.message : fallback,
        fieldErrors: stringRecord(d.field_errors),
        schemaErrors: schemaErrorList(d.schema_errors),
        body,
      });
    }
  }
  if (typeof body === "string" && body.trim() !== "" && body.length < 500) {
    return new ApiError({ status, detail: body.trim(), body });
  }
  return new ApiError({ status, detail: fallback, body });
}
