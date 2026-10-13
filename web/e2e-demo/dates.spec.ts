import { expect, test } from "@playwright/test";
import { go, signIn } from "./helpers";

/** Fixtures exported days ago are shifted at load so the demo always ends "this morning". */
test("data exported nine days ago reads as today", async ({ page }) => {
  const later = new Date(Date.now() + 9 * 86_400_000);
  await page.clock.setFixedTime(later);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(later);

  await signIn(page, "Owner");
  await expect(page.getByText(`All groups · ${label} (today)`)).toBeVisible();
  const rows = page.locator("table").first().locator("tbody tr");
  await expect(rows).toHaveCount(16);
  await expect(page.locator('td[data-flag="red"]').first()).toBeVisible();

  await go(page, "/data");
  await expect(page.locator("table tbody tr").first()).toContainText(label.replace(/^(\w+) (\d+),/, "$1 $2,"));
});
