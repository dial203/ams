import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/** The same build served at a domain root (no sub-path): assets and fixtures resolve relative to the page. */
test("works at the domain root", async ({ page }) => {
  const fixture = page.waitForResponse((r) => /\/demo\/owner\.json$/.test(r.url()) && r.ok());
  await signIn(page, "Owner");
  expect(new URL((await fixture).url()).pathname).toBe("/demo/owner.json");
  await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(16);
  await expect(page.locator('td[data-flag="red"]').first()).toBeVisible();
});
