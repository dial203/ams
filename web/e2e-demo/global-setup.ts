import { existsSync, readFileSync } from "node:fs";

/** Fails fast when web/dist is not a demo build with fixtures. */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_DEMO_BASE_URL) return;
  const index = new URL("../dist/index.html", import.meta.url);
  const fixture = new URL("../dist/demo/owner.json", import.meta.url);
  const hint = "Build the demo first: scripts/build-demo.sh (needs DATABASE_URL), or export fixtures to web/public/demo and run pnpm --filter @ams/web build:demo.";
  if (!existsSync(index) || !existsSync(fixture)) throw new Error(`web/dist is not a demo build with fixtures. ${hint}`);
  if (!readFileSync(index, "utf8").includes('src="./assets/')) throw new Error(`web/dist was not built with --mode demo (relative asset URLs). ${hint}`);
}
