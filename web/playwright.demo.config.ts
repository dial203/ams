import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests of the in-browser demo build (no API). Build it first:
 *   scripts/build-demo.sh            (fixtures from a seeded database + `vite build --mode demo`)
 * The build is served twice with `vite preview`: under /ams/ (like GitHub Pages) for the full
 * suite, and at the domain root for a smoke test, to prove one build works at both.
 * Set E2E_DEMO_BASE_URL to test a deployed demo instead (full suite only).
 */
const SUB_PATH_PORT = 4180;
const ROOT_PORT = 4181;
const deployed = process.env.E2E_DEMO_BASE_URL;
const viewport = { width: 1440, height: 900 };

export default defineConfig({
  testDir: "./e2e-demo",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e-demo/global-setup.ts",
  use: { viewport, trace: "retain-on-failure", screenshot: "only-on-failure", acceptDownloads: true },
  projects: [
    {
      name: "sub-path",
      testIgnore: /root\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport, baseURL: deployed ?? `http://localhost:${SUB_PATH_PORT}/ams/` },
    },
    ...(deployed
      ? []
      : [
          {
            name: "domain-root",
            testMatch: /root\.spec\.ts/,
            use: { ...devices["Desktop Chrome"], viewport, baseURL: `http://localhost:${ROOT_PORT}/` },
          },
        ]),
  ],
  webServer: deployed
    ? undefined
    : [
        {
          command: `pnpm exec vite preview --base /ams/ --port ${SUB_PATH_PORT} --strictPort`,
          url: `http://localhost:${SUB_PATH_PORT}/ams/`,
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: `pnpm exec vite preview --base / --port ${ROOT_PORT} --strictPort`,
          url: `http://localhost:${ROOT_PORT}/`,
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
});
