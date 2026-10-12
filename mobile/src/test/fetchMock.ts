/** A `fetch` double for the shared API client: routes by "METHOD /path" (without `/api/v1`). */

export interface MockRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

export type MockResult = { status?: number; body?: unknown } | Error;
export type MockHandler = MockResult | ((req: MockRequest) => MockResult | Promise<MockResult>);

interface MinimalResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

function response(status: number, body: unknown): MinimalResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

function parseUrl(input: string): { path: string; query: Record<string, string> } {
  const withoutOrigin = input.replace(/^[a-z]+:\/\/[^/]+/i, "");
  const [rawPath = "", rawQuery = ""] = withoutOrigin.split("?");
  const query: Record<string, string> = {};
  for (const pair of rawQuery.split("&").filter(Boolean)) {
    const [k = "", v = ""] = pair.split("=");
    query[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return { path: decodeURIComponent(rawPath.replace(/^\/api\/v1/, "")), query };
}

export function createFetchMock(routes: Record<string, MockHandler> = {}) {
  const calls: MockRequest[] = [];
  const fetchFn = jest.fn(async (input: string, init: RequestInit = {}) => {
    const { path, query } = parseUrl(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    let body: unknown = undefined;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const req: MockRequest = { method, path, query, body, headers: (init.headers ?? {}) as Record<string, string> };
    calls.push(req);
    const handler = routes[`${method} ${path}`];
    if (handler === undefined) return response(404, { detail: `No mock for ${method} ${path}` });
    const result = typeof handler === "function" ? await handler(req) : handler;
    if (result instanceof Error) throw result;
    return response(result.status ?? 200, result.body);
  });
  return {
    fetch: fetchFn as unknown as typeof fetch,
    fetchFn,
    calls,
    routes,
    /** Requests matching "METHOD /path". */
    callsTo: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key),
  };
}

/** What fetch throws when the device is offline. */
export function networkError(): TypeError {
  return new TypeError("Network request failed");
}
