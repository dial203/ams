/** A tiny method + path-template router for the demo backend. */
import type { DemoRequest, DemoResponse } from "./http";
import { record } from "./http";
import type { DemoStore } from "./store";

export interface Ctx {
  req: DemoRequest;
  /** Decoded path parameters (`:name` in the template). */
  params: Record<string, string>;
  store: DemoStore;
  /** The JSON body as an object (422 otherwise). */
  body(): Record<string, unknown>;
}

export type Handler = (ctx: Ctx) => DemoResponse | Promise<DemoResponse>;

export interface RouteDef {
  method: string;
  template: string;
  handler: Handler;
}

export function route(method: string, template: string, handler: Handler): RouteDef {
  return { method, template, handler };
}

interface Compiled extends RouteDef {
  re: RegExp;
  keys: string[];
}

export interface Match {
  handler: Handler;
  params: Record<string, string>;
}

export function compileRoutes(defs: readonly RouteDef[]): (method: string, path: string) => Match | null {
  const compiled: Compiled[] = defs.map((d) => {
    const keys: string[] = [];
    const pattern = d.template
      .split("/")
      .map((seg) => {
        if (seg.startsWith(":")) {
          keys.push(seg.slice(1));
          return "([^/]+)";
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return { ...d, re: new RegExp(`^${pattern}/?$`), keys };
  });
  return (method, path) => {
    for (const r of compiled) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]!);
      });
      return { handler: r.handler, params };
    }
    return null;
  };
}

export function makeCtx(req: DemoRequest, params: Record<string, string>, store: DemoStore): Ctx {
  return { req, params, store, body: () => record(req.body) };
}
