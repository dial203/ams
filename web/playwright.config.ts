import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running AMS API with the demo seed
 * (`uv run python -m app.cli seed-demo`). Set E2E_API_URL if it is not on :8001.
 * The web app is started with `vite` unless E2E_BASE_URL points at a running one.
 */
const apiUrl = process.env.E2E_API_URL ?? "http://localhost:8001";
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm exec vite --port 5173 --strictPort",
        url: baseURL,
        reuseExistingServer: true,
        env: { VITE_API_URL: apiUrl },
        timeout: 60_000,
      },
});
