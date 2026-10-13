import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { go, signIn } from "./helpers";

/** Each demo role sees what that login sees on a real server (the fixtures are its API responses). */

test("coach: the Athletics squad and general forms only", async ({ page }) => {
  await signIn(page, "Coach");
  await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(16);
  await go(page, "/forms");
  await expect(page.getByRole("button", { name: /Morning wellness/ })).toBeVisible();
  await expect(page.getByText("Injury report")).toHaveCount(0);
  await go(page, "/settings");
  await expect(page.getByRole("tab", { name: "Members" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Invitations" })).toHaveCount(0);
});

test("medical: sees the medical injury report form", async ({ page }) => {
  await signIn(page, "Medical");
  await go(page, "/forms");
  await expect(page.getByRole("button", { name: /Injury report/ })).toBeVisible();
});

test("blinded researcher: codes only, everywhere", async ({ page }) => {
  await signIn(page, "Blinded researcher");
  const board = page.locator("table").first();
  await expect(board.locator("tbody tr")).toHaveCount(6);
  await expect(board.locator("tbody tr").first()).toContainText(/A-00\d\d/);
  await expect(page.getByText("Maya")).toHaveCount(0);

  await go(page, "/athletes");
  await expect(page.getByText("6 total")).toBeVisible();
  await expect(page.getByText("De-identified").first()).toBeVisible();
  // names never match for masked athletes (Leo Lindqvist is A-0002, in the study)
  await page.getByPlaceholder("Search name, code, email…").fill("Leo");
  await expect(page.getByText("0 total")).toBeVisible();
  await page.getByPlaceholder("Search name, code, email…").fill("A-0002");
  await page.getByRole("button", { name: /A-0002/ }).first().click();
  await expect(page.getByRole("heading", { name: /A-0002/ })).toBeVisible();
  await expect(page.locator(".recharts-surface").first()).toBeVisible();

  await go(page, "/data");
  await page.getByLabel("Form", { exact: true }).selectOption({ label: "Morning wellness (Hooper)" });
  await expect(page.locator("table tbody tr").first()).toContainText(/A-00\d\d/);
  await page.getByRole("button", { name: "Export CSV" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv.split("\n")[0]).not.toContain("athlete_name");
  expect(csv).not.toMatch(/Lindqvist|Ruiz|Patel|Byrne|Tanaka|Silva/);
});

test("athlete: their own submissions and a pointer to the mobile app", async ({ page }) => {
  await go(page, "/login");
  await page.getByRole("button", { name: /^Athlete/ }).click();
  await expect(page.getByText(/mobile app/i).first()).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toBeVisible();

  // the banner signs out to pick another role
  await page.getByRole("button", { name: "Switch role" }).click();
  await expect(page.getByRole("heading", { name: "Try the demo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch role" })).toHaveCount(0);
});
