import { expect, type Page } from "@playwright/test";

export const ADMIN = { email: "admin@example.com", password: process.env.AMS_DEMO_PASSWORD ?? "demo-password-change-me" };

export async function login(page: Page, user = ADMIN): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Users with several organizations pick one first (the demo org).
  const picker = page.getByRole("heading", { name: "Choose an organization" });
  const board = page.getByRole("heading", { name: "Readiness" });
  await expect(picker.or(board)).toBeVisible();
  if (await picker.isVisible()) await page.getByRole("button", { name: /Demo Performance/ }).click();
  await expect(board).toBeVisible();
}

export function shot(name: string): string {
  return `e2e/screenshots/${name}.png`;
}
