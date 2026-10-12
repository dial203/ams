import { expect, type Page } from "@playwright/test";

export const ADMIN = { email: "admin@example.com", password: process.env.AMS_DEMO_PASSWORD ?? "demo-password-change-me" };

export async function login(page: Page, user = ADMIN): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Readiness" })).toBeVisible();
}

export function shot(name: string): string {
  return `e2e/screenshots/${name}.png`;
}
