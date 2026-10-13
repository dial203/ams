/**
 * Entry point of the demo build (`VITE_DEMO=1`), loaded by `main.tsx` with a dynamic import
 * so none of this ships in normal builds.
 */
import { createHashHistory, type RouterHistory } from "@tanstack/react-router";
import type { ComponentType } from "react";
import type { DemoMode } from "@/lib/demo-mode";
import { DEMO_ACCOUNTS } from "./accounts";
import { DEMO_API_BASE, createDemoFetch } from "./backend";
import { DemoBanner } from "./DemoBanner";

export interface DemoSetup {
  apiBase: string;
  fetch: typeof fetch;
  /** Hash routing: works on static hosting at any path without rewrite rules. */
  history: RouterHistory;
  mode: DemoMode;
  Banner: ComponentType;
}

/** Another role is another person: forget the group filter and organization the last one picked. */
function forgetPreviousRole(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("ams.group.") || key === "ams.org_id") localStorage.removeItem(key);
    }
  } catch {
    /* storage blocked */
  }
}

export function setupDemo(): DemoSetup {
  const demoFetch = createDemoFetch({ latency: 120, onLogin: forgetPreviousRole });
  // The fake API from the console (and for the demo's end-to-end tests): __AMS_DEMO__.fetch("/api/v1/...").
  Object.assign(window, { __AMS_DEMO__: { fetch: demoFetch, backend: demoFetch.backend } });
  return { apiBase: DEMO_API_BASE, fetch: demoFetch, history: createHashHistory(), mode: { accounts: DEMO_ACCOUNTS }, Banner: DemoBanner };
}
