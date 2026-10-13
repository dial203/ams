import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { demoApi, go, orgToday, shot, signIn } from "./helpers";

/**
 * The demo build as the owner: every page, the main write flows against the in-browser API,
 * and a reload that throws the changes away.
 */

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});

test.afterAll(async () => {
  await page.close();
});

test("one-click sign-in and the readiness board with flags", async () => {
  await go(page, "/");
  await expect(page.getByRole("heading", { name: "Try the demo" })).toBeVisible();
  await expect(page.getByRole("note", { name: "Demo" })).toContainText("Demo with synthetic data");
  await signIn(page, "Owner");
  // the fixture is shifted so that its last day is today
  await expect(page.getByText(/All groups · .*\(today\)/)).toBeVisible();
  const rows = page.locator("table").first().locator("tbody tr");
  await expect(rows).toHaveCount(16);
  await expect(page.locator('td[data-flag="red"]').first()).toBeVisible();
  await expect(page.locator('td[data-flag="amber"]').first()).toBeVisible();
  await expect(page.getByRole("group", { name: "Summary" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("readiness-board") });

  // earlier days come from the exported boards; the group filter narrows the rows
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page.getByText(/\(today\)/)).toHaveCount(0);
  await expect(rows).toHaveCount(16);
  await page.getByRole("combobox", { name: "Group filter" }).click();
  await page.getByRole("option", { name: /Sprints/ }).click();
  await expect(rows).toHaveCount(8);
  await page.getByRole("combobox", { name: "Group filter" }).click();
  await page.getByRole("option", { name: /All groups/ }).click();
  await expect(rows).toHaveCount(16);
});

test("athlete detail: trend charts, submissions, wearables", async () => {
  await go(page, "/athletes");
  await page.getByPlaceholder("Search name, code, email…").fill("Maya");
  await page.getByRole("button", { name: /Maya Okafor/ }).click();
  await expect(page.getByRole("heading", { name: /Maya Okafor/ })).toBeVisible();
  await expect(page.getByText("Readiness trends")).toBeVisible();
  await expect(page.locator(".recharts-surface")).toHaveCount(5);
  await expect(page.locator(".recharts-line-curve").first()).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("athlete-detail") });

  await page.getByRole("tab", { name: "Data" }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await page.locator("table tbody tr").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Wearables" }).click();
  await expect(page.getByText("Wearables are not set up on this server")).toBeVisible();
  await expect(page.getByText("Daily wearable data")).toBeVisible();
  await expect(page.getByText("HRV (RMSSD)")).toBeVisible();
});

test("form builder: create, live preview, publish", async () => {
  const name = `Grip test ${Date.now().toString().slice(-5)}`;
  await go(page, "/forms");
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

  // the published form takes data right away
  await go(page, "/entry?mode=single");
  await expect(page.getByLabel("Form", { exact: true }).locator("option", { hasText: name })).toHaveCount(1);
});

test("team grid: enter two rows and save; the grid shows them as saved", async () => {
  await go(page, "/entry");
  await page.getByLabel("Form", { exact: true }).selectOption({ label: "Session RPE" });
  await page.getByRole("combobox", { name: "Group", exact: true }).click();
  await page.getByRole("option", { name: /Sprints/ }).click();
  const grid = page.getByRole("grid");
  const rows = grid.locator("tbody tr");
  await expect(rows).toHaveCount(8);
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

test("single entry: the server validates (422) and refuses a second wellness on the same day (409)", async () => {
  // 422 from the in-browser API: the shared form engine validates like the server
  const me = (await demoApi(page, "GET", "/me")).body as { memberships: { org: { id: string } }[] };
  const org = me.memberships[0]!.org.id;
  const forms = (await demoApi(page, "GET", `/orgs/${org}/forms`)).body as { id: string; slug: string }[];
  const wellness = forms.find((f) => f.slug === "wellness_hooper")!;
  const athletes = (await demoApi(page, "GET", `/orgs/${org}/athletes?q=A-0001`)).body as { items: { id: string }[] };
  const bad = await demoApi(page, "POST", `/orgs/${org}/submissions`, {
    form_id: wellness.id,
    athlete_id: athletes.items[0]!.id,
    values: { sleep_quality: 9, fatigue: "high" },
  });
  expect(bad.status).toBe(422);
  expect((bad.body as { detail: { field_errors: Record<string, string> } }).detail.field_errors).toMatchObject({
    sleep_quality: "out_of_range",
    fatigue: "invalid_type",
    has_pain: "required",
  });

  // 409 through the form: save once (or find today's), then again
  await go(page, "/entry?mode=single");
  await page.getByLabel("Form", { exact: true }).selectOption({ label: "Morning wellness (Hooper)" });
  await page.getByRole("combobox", { name: "Athlete", exact: true }).click();
  await page.getByLabel("Search athletes").fill("Maya");
  await page.getByRole("option", { name: /Maya Okafor/ }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Save submission" }) });
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const label of ["Sleep quality", "Fatigue", "Stress", "Muscle soreness"]) {
      await form.getByRole("radiogroup", { name: label }).getByRole("radio", { name: "3" }).click();
    }
    await form.getByRole("radiogroup", { name: "Any pain or injury?" }).getByRole("radio", { name: "No" }).click();
    await form.getByRole("button", { name: "Save submission" }).click();
    await expect(page.getByText(/Already submitted for|Saved Morning wellness/).first()).toBeVisible();
    if (await page.getByText(/Already submitted for/).isVisible()) break;
  }
  await expect(page.getByText(/Already submitted for/)).toBeVisible();
});

test("data explorer and CSV export (named and de-identified)", async () => {
  await go(page, "/data");
  await page.getByLabel("Form", { exact: true }).selectOption({ label: "Session RPE" });
  await expect(page.locator("table tbody tr").first()).toBeVisible();

  await page.getByRole("button", { name: "Export CSV" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^session_rpe_.*\.csv$/);
  const csv = readFileSync((await download.path())!, "utf8");
  const [header, ...lines] = csv.trim().split("\n");
  expect(header).toMatch(/^submission_id,athlete_code,athlete_name,local_date,observed_at,source,form_version,session_type,rpe,duration,.*srpe$/);
  expect(lines.length).toBeGreaterThan(100);
  expect(csv).toContain("Maya Okafor");

  await page.getByRole("switch").click();
  const [anon] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
  expect(anon.suggestedFilename()).toMatch(/_deidentified\.csv$/);
  const anonCsv = readFileSync((await anon.path())!, "utf8");
  expect(anonCsv.split("\n")[0]).not.toContain("athlete_name");
  expect(anonCsv).not.toContain("Maya Okafor");
  await page.keyboard.press("Escape");
});

test("import wizard: XLSX is refused, a CSV dry run, import and roll back", async () => {
  await go(page, "/data?tab=import");
  await page.getByLabel("Which form do the rows belong to?").selectOption({ label: "Session RPE" });
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByLabel("Choose file")
    .setInputFiles({ name: "export.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("PK") });
  await expect(page.getByText("XLSX import is not available in the demo", { exact: false }).first()).toBeVisible();

  const today = orgToday();
  const csv = [
    "Athlete Code,Session Date,Session Type,RPE,Minutes",
    `A-0001,${today},field,6,70`,
    `A-0002,${today},gym,4,55`,
    `A-9999,${today},field,5,60`,
  ].join("\n");
  await page.getByLabel("Choose file").setInputFiles({ name: "gps-export.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByRole("heading", { name: "Columns → fields" })).toBeVisible();
  await page.getByLabel("Athlete column").selectOption("Athlete Code");
  await page.getByLabel("Match by").selectOption("code");
  await page.getByLabel("Date column").selectOption("Session Date");
  await page.getByRole("combobox", { name: "Field for column Session Type" }).selectOption("session_type");
  await page.getByRole("combobox", { name: "Field for column RPE" }).selectOption("rpe");
  await page.getByRole("combobox", { name: "Field for column Minutes" }).selectOption("duration");
  await page.screenshot({ path: shot("import-wizard"), fullPage: true });
  await page.getByRole("button", { name: "Check import (dry run)" }).click();
  await expect(page.getByText(/Dry run: 2 of 3 rows would be imported/)).toBeVisible();
  await expect(page.getByText(/no athlete matches 'A-9999'/)).toBeVisible();
  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByText(/2 of 3 rows imported/)).toBeVisible();
  await page.getByRole("button", { name: "Import history" }).click();
  await expect(page.getByRole("cell", { name: /gps-export\.csv/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Roll back" }).first().click();
  await page.getByRole("button", { name: "Roll back" }).last().click();
  await expect(page.getByText("Import rolled back")).toBeVisible();
});

test("metrics: definitions, ACWR caveat and the precomputed preview", async () => {
  await go(page, "/metrics?slug=acwr");
  await expect(page.getByText("Read before using this metric")).toBeVisible();
  await page.getByRole("combobox", { name: /Preview athlete/i }).click();
  await page.getByLabel("Search athletes").fill("Maya");
  await page.getByRole("option", { name: /Maya Okafor/ }).click();
  await expect(page.getByText(/[1-9]\d* of 56 days have a value/)).toBeVisible();
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
});

test("settings: organization, members, invitations, Open Wearables", async () => {
  await go(page, "/settings");
  await expect(page.getByText("Readiness board")).toBeVisible();
  await page.getByRole("tab", { name: "Members" }).click();
  await expect(page.getByText("coach@example.com")).toBeVisible();
  await page.getByRole("tab", { name: "Invitations" }).click();
  await page.getByLabel("Email").fill("new.coach@example.org");
  await page.getByRole("button", { name: "Create invite" }).click();
  await expect(page.getByRole("textbox", { name: "Invite link" })).toHaveValue(/#\/accept-invite\?token=demo-/);
  await page.getByRole("tab", { name: "Open Wearables" }).click();
  await expect(page.getByText("Wearables are not set up on this server")).toBeVisible();
});

test("a reload resets every change and keeps the role signed in", async () => {
  await go(page, "/athletes");
  await page.getByRole("button", { name: "New athlete" }).click();
  await page.getByLabel("First name").fill("Reset");
  await page.getByLabel("Last name").fill("Check");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Reset Check/ })).toBeVisible();
  await go(page, "/athletes");
  await page.getByPlaceholder("Search name, code, email…").fill("Reset");
  await expect(page.getByRole("button", { name: /Reset Check/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Athletes" })).toBeVisible();
  await page.getByPlaceholder("Search name, code, email…").fill("Reset");
  await expect(page.getByRole("button", { name: /Reset Check/ })).toHaveCount(0);
  await page.getByPlaceholder("Search name, code, email…").fill("");
  await expect(page.getByText("16 total")).toBeVisible();
});
