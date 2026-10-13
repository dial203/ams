import { expect, type Page } from "@playwright/test";

/** Opens an app route; the demo uses hash routing below the page the build is served at. */
export async function go(page: Page, route: string): Promise<void> {
  await page.goto(`./#${route}`);
}

/** Signs in with a role button on the demo login page (e.g. "Owner", "Blinded researcher"). */
export async function signIn(page: Page, role: string, landing = "Readiness"): Promise<void> {
  await go(page, "/login");
  await page.getByRole("button", { name: new RegExp(`^${role}`) }).click();
  await expect(page.getByRole("heading", { name: landing }).first()).toBeVisible();
}

export function shot(name: string): string {
  return `e2e-demo/screenshots/${name}.png`;
}

/** Today in the demo organization's time zone (the demo shifts its data to end today). */
export function orgToday(timeZone = "America/New_York"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Calls the in-page fake API (window.__AMS_DEMO__) with the signed-in token. */
export async function demoApi(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const demo = (window as unknown as { __AMS_DEMO__: { fetch: typeof fetch } }).__AMS_DEMO__;
      const headers: Record<string, string> = { Authorization: `Bearer ${localStorage.getItem("ams.access_token") ?? ""}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await demo.fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      return { status: res.status, body: text ? (JSON.parse(text) as unknown) : undefined };
    },
    { method, path, body },
  );
}
