import { expect, test, type Page } from "@playwright/test";
import { login, shot } from "./helpers";

/**
 * Walks the main staff pages against the demo seed ("Demo Performance": Athletics with
 * Sprints and Distance squads, a Pilot Study, Hooper wellness, session RPE, CMJ, GPS and
 * body-mass forms, ~6 weeks of data). Writes reviewer screenshots to e2e/screenshots/.
 */

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(page);
});

test.afterAll(async () => {
  await page.close();
});

test("readiness board shows flags, summary and sorting", async () => {
  await page.goto("/");
  const table = page.locator("table").first();
  await expect(table.locator("tbody tr").first()).toBeVisible();
  await expect(page.getByRole("group", { name: "Summary" })).toBeVisible();
  // flags are colour + icon + text
  await expect(page.locator('td[data-flag="red"], td[data-flag="amber"]').first()).toBeVisible();
  await expect(page.getByText(/(Red|Amber) flag/).first()).toBeAttached();
  await page.screenshot({ path: shot("readiness-board") });

  // sort by the first metric column
  await page.getByRole("button", { name: /Wellness/ }).first().click();
  await expect(page.getByRole("columnheader", { name: /Wellness/ })).toHaveAttribute("aria-sort", /ascending|descending/);

  // group filter persists across pages
  await page.getByRole("combobox", { name: "Group filter" }).click();
  await page.getByRole("option", { name: /Sprints/ }).click();
  await expect(page.getByText("Sprints ·", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Athletes" }).click();
  await expect(page.getByRole("combobox", { name: "Group filter" })).toContainText("Sprints");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Group filter" })).toContainText("Sprints");
  await page.getByRole("combobox", { name: "Group filter" }).click();
  await page.getByRole("option", { name: /All groups/ }).click();

  // dark theme and tablet width
  await page.goto("/");
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("readiness-board-dark-tablet") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
});

test("athlete detail: trends, data, wearables, profile", async () => {
  await page.goto("/athletes");
  await page.getByPlaceholder("Search name, code, email…").fill("Maya");
  await page.getByRole("button", { name: /Maya Okafor/ }).click();
  await expect(page.getByRole("heading", { name: /Maya Okafor/ })).toBeVisible();
  await expect(page.getByText("Readiness trends")).toBeVisible();
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("athlete-detail") });

  await page.getByRole("tab", { name: "Data" }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await page.locator("table tbody tr").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Wearables" }).click();
  // Open Wearables is not configured in this environment: the page says so plainly.
  await expect(page.getByText(/Wearables are not set up on this server|Connections/).first()).toBeVisible();

  await page.getByRole("tab", { name: "Profile" }).click();
  await expect(page.getByLabel("Position / role")).toBeVisible();
});

test("groups tree and members", async () => {
  await page.goto("/groups");
  await expect(page.getByRole("tree", { name: "Groups" })).toBeVisible();
  await page.getByRole("treeitem").filter({ hasText: "Sprints" }).getByRole("button", { name: /Sprints/ }).click();
  await expect(page.getByRole("heading", { name: /Sprints/ })).toBeVisible();
  await expect(page.getByText("direct member")).toBeVisible();
  await page.getByRole("tab", { name: "Staff access" }).click();
  await expect(page.getByRole("button", { name: "Assign" })).toBeVisible();
});

test("form builder: create, edit with live preview, publish", async () => {
  await page.goto("/forms");
  await page.getByRole("button", { name: /Morning wellness/ }).first().click();
  await expect(page.getByRole("tab", { name: "Build" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Live preview" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("form-builder") });

  const name = `E2E check ${Date.now()}`;
  await page.goto("/forms");
  await page.getByRole("button", { name: "New form" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create and open builder" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.getByRole("button", { name: "Add field" }).first().click();
  await page.getByRole("menuitem", { name: "Number" }).click();
  await page.getByLabel("Label", { exact: true }).fill("Grip strength");
  await expect(page.getByLabel("Key", { exact: true })).toHaveValue("grip_strength");
  await page.getByRole("button", { name: "Add field" }).first().click();
  await page.getByRole("menuitem", { name: "Calculated" }).click();
  await page.getByLabel("Label", { exact: true }).fill("Grip x2");
  await page.getByLabel("Expression", { exact: true }).fill("grip_strength * 2");
  await expect(page.getByText("Valid expression")).toBeVisible();
  const preview = page.getByRole("complementary", { name: "Live preview" });
  await preview.getByLabel("Grip strength", { exact: true }).fill("21");
  await expect(preview.getByRole("status", { name: "Grip x2" })).toHaveText("42");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published version 1")).toBeVisible();
  await page.getByRole("tab", { name: "Versions" }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
});

test("team grid: keyboard entry and bulk save", async () => {
  await page.goto("/entry");
  await page.getByLabel("Form", { exact: true }).selectOption({ label: "Session RPE" });
  await page.getByRole("combobox", { name: "Group", exact: true }).click();
  await page.getByRole("option", { name: /Sprints/ }).click();
  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();
  const rows = grid.locator("tbody tr");
  await expect(rows.first()).toBeVisible();

  // first two athletes: type, RPE, duration via keyboard
  for (const r of [0, 1]) {
    const row = rows.nth(r);
    await row.locator("select").first().selectOption({ index: 1 });
    await row.locator("select").nth(1).focus();
    await page.keyboard.press("5");
    await page.keyboard.press("Tab");
    await page.keyboard.type(r === 0 ? "1:15" : "60");
  }
  await expect(rows.nth(0)).toContainText("375");
  await expect(rows.nth(1)).toContainText("300");
  await page.screenshot({ path: shot("team-grid") });
  await page.getByRole("button", { name: /Save all/ }).click();
  await expect(rows.nth(0)).toContainText("Saved");
  await expect(rows.nth(1)).toContainText("Saved");
});

test("single entry reports a duplicate day", async () => {
  await page.goto("/entry?mode=single");
  await page.getByLabel("Form", { exact: true }).selectOption({ label: "Morning wellness (Hooper)" });
  await page.getByRole("combobox", { name: "Athlete", exact: true }).click();
  await page.getByLabel("Search athletes").fill("Maya");
  await page.getByRole("option", { name: /Maya Okafor/ }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Save submission" }) });
  for (const label of ["Sleep quality", "Fatigue", "Stress", "Muscle soreness"]) {
    await form.getByRole("radiogroup", { name: label }).getByRole("radio", { name: "3" }).click();
  }
  await form.getByRole("radiogroup", { name: "Any pain or injury?" }).getByRole("radio", { name: "No" }).click();
  await form.getByRole("button", { name: "Save submission" }).click();
  // The seed has today's wellness for most athletes; either it saves or the 409 is explained.
  await expect(page.getByText(/Already submitted for|Saved Morning wellness/).first()).toBeVisible();
});

test("data explorer and CSV export", async () => {
  await page.goto("/data");
  await page.getByLabel("Form", { exact: true }).selectOption({ label: "Session RPE" });
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await page.getByRole("button", { name: "Export CSV" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^session_rpe_.*\.csv$/);
});

test("import wizard: upload, map, dry run, import, roll back", async () => {
  await page.goto("/data?tab=import");
  await page.getByLabel("Which form do the rows belong to?").selectOption({ label: "Session RPE" });
  await page.getByRole("button", { name: "Continue" }).click();
  const today = new Date().toISOString().slice(0, 10);
  const csv = [
    "Athlete Code,Session Date,Session Type,RPE,Minutes",
    `A-0001,${today},field,6,70`,
    `A-0002,${today},gym,4,55`,
    `A-9999,${today},field,5,60`,
  ].join("\n");
  await page.getByLabel("Choose file").setInputFiles({ name: "gps-export.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByRole("heading", { name: "Columns → fields" })).toBeVisible();
  // make sure every column is mapped to the right field
  await page.getByLabel("Athlete column").selectOption("Athlete Code");
  await page.getByLabel("Match by").selectOption("code");
  await page.getByLabel("Date column").selectOption("Session Date");
  await page.getByRole("combobox", { name: "Field for column Session Type" }).selectOption("session_type");
  await page.getByRole("combobox", { name: "Field for column RPE" }).selectOption("rpe");
  await page.getByRole("combobox", { name: "Field for column Minutes" }).selectOption("duration");
  await page.screenshot({ path: shot("import-wizard"), fullPage: true });
  await page.getByRole("button", { name: "Check import (dry run)" }).click();
  await expect(page.getByText(/Dry run: 2 of 3 rows would be imported/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "3" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByText(/2 of 3 rows imported/)).toBeVisible();
  await page.getByRole("button", { name: "Import history" }).click();
  await expect(page.getByRole("cell", { name: /gps-export\.csv/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Roll back" }).first().click();
  await page.getByRole("button", { name: "Roll back" }).last().click();
  await expect(page.getByText("Import rolled back")).toBeVisible();
});

test("metrics: caveat and preview", async () => {
  await page.goto("/metrics?slug=acwr");
  await expect(page.getByText("Read before using this metric")).toBeVisible();
  await page.getByRole("combobox", { name: /Preview athlete/i }).click();
  await page.getByLabel("Search athletes").fill("Maya");
  await page.getByRole("option", { name: /Maya Okafor/ }).click();
  await expect(page.getByText(/days have a value/)).toBeVisible();
});

test("settings: organization, members, invitations, Open Wearables", async () => {
  await page.goto("/settings");
  await expect(page.getByText("Readiness board")).toBeVisible();
  await page.getByRole("tab", { name: "Members" }).click();
  await expect(page.getByText("coach@example.com")).toBeVisible();
  await page.getByRole("tab", { name: "Invitations" }).click();
  await page.getByLabel("Email").fill(`new.coach.${Date.now()}@example.org`);
  await page.getByRole("button", { name: "Create invite" }).click();
  await expect(page.getByRole("textbox", { name: "Invite link" })).toHaveValue(/accept-invite\?token=/);
  await page.getByRole("tab", { name: "Open Wearables" }).click();
  await expect(page.getByText(/Wearables are not set up on this server|Connected service/)).toBeVisible();
});

test("de-identified researcher sees codes only", async ({ browser }) => {
  const p = await browser.newPage();
  await login(p, { email: "researcher@example.com", password: process.env.AMS_DEMO_PASSWORD ?? "demo-password-change-me" });
  await p.goto("/athletes");
  await expect(p.getByText("De-identified").first()).toBeVisible();
  await p.close();
});
