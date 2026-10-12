import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/** Admin write workflows against the demo seed: people, groups, submissions, schedules, metrics, terminology. */

test.describe.configure({ mode: "serial" });

let page: Page;
const stamp = Date.now().toString().slice(-6);

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(page);
});

test.afterAll(async () => {
  await page.close();
});

test("create an athlete and add them to a new group", async () => {
  await page.goto("/athletes");
  await page.getByRole("button", { name: "New athlete" }).click();
  await page.getByLabel("First name").fill("Test");
  await page.getByLabel("Last name").fill(`Runner${stamp}`);
  await page.getByLabel("Position / role").fill("400mH");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Test Runner${stamp}`) })).toBeVisible();

  await page.goto("/groups");
  await page.getByRole("button", { name: "New group" }).click();
  await page.getByLabel("Name").fill(`Hurdles ${stamp}`);
  await page.getByLabel("Kind").selectOption("squad");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Hurdles ${stamp}`) })).toBeVisible();
  await page.getByRole("button", { name: "Add athletes" }).click();
  await page.getByRole("dialog").getByLabel("Search").fill(`Runner${stamp}`);
  await page.getByRole("dialog").locator("label").filter({ hasText: `Runner${stamp}` }).getByRole("checkbox").click();
  await page.getByRole("dialog").getByRole("button", { name: /^Add/ }).click();
  await expect(page.getByText("1 direct member")).toBeVisible();
  await page.getByRole("button", { name: /Remove Test Runner/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("0 direct members")).toBeVisible();

  // staff access with codes only
  await page.getByRole("tab", { name: "Staff access" }).click();
  await page.getByLabel("Staff member").selectOption({ label: "Casey Coach (staff)" });
  await page.getByLabel("Access role").selectOption("viewer");
  await page.getByRole("switch").last().click();
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByText("Codes only", { exact: true })).toBeVisible();
});

test("edit and delete a submission", async () => {
  await page.goto("/data");
  await page.getByLabel("Form", { exact: true }).selectOption({ label: "Countermovement jump (force plate)" });
  const first = page.locator("table tbody tr").first();
  await expect(first).toBeVisible();
  await first.click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Edit" }).click();
  const height = sheet.getByRole("textbox", { name: /Jump height/ });
  await height.fill("41.5");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Submission updated")).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toContainText("41.5");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.locator("table tbody tr").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Submission deleted")).toBeVisible();
});

test("schedule a form for a group", async () => {
  await page.goto("/forms");
  await page.getByRole("button", { name: /Morning body mass/ }).click();
  await page.getByRole("tab", { name: "Schedules" }).click();
  await page.getByRole("button", { name: "New schedule" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: /Group/ }).click();
  await page.getByRole("option", { name: /Distance/ }).click();
  await dialog.getByLabel("Repeats").selectOption("weekly");
  await dialog.getByRole("button", { name: "Sat" }).click();
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Schedule created")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Weekly: Mon, Tue, Wed, Thu, Fri, Sat/ }).first()).toBeVisible();
});

test("create a custom metric and preview it", async () => {
  await page.goto("/metrics?slug=new");
  await page.getByLabel("Name").fill(`Body mass 7-d mean ${stamp}`);
  await page.getByLabel("Slug").fill(`body_mass_7d_${stamp}`);
  await page.getByRole("combobox", { name: "Source", exact: true }).click();
  await page.getByLabel("Search sources").fill("body mass");
  await page.getByRole("option", { name: /Morning body mass: Body mass/ }).first().click();
  await page.getByLabel("Transform").selectOption("rolling_mean");
  await page.getByLabel("Window (days)").fill("7");
  await page.getByRole("button", { name: "Create metric" }).click();
  await expect(page.getByText("Metric created")).toBeVisible();
  await page.getByRole("combobox", { name: /Preview athlete/ }).click();
  await page.getByLabel("Search athletes").fill("Maya");
  await page.getByRole("option", { name: /Maya Okafor/ }).click();
  await expect(page.getByText(/days have a value/)).toBeVisible();
});

test("terminology changes the UI wording", async () => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Tactical" }).click();
  await page.getByRole("button", { name: "Save organization settings" }).click();
  await expect(page.getByText("Organization settings saved")).toBeVisible();
  await expect(page.getByRole("link", { name: "Operators" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Units" })).toBeVisible();
  await page.getByRole("button", { name: "Sport" }).click();
  await page.getByRole("button", { name: "Save organization settings" }).click();
  await expect(page.getByRole("link", { name: "Athletes" })).toBeVisible();
});
