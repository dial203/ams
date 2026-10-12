/** Fails fast with a useful message when the API is not reachable. */
export default async function globalSetup(): Promise<void> {
  const api = process.env.E2E_API_URL ?? "http://localhost:8001";
  try {
    const res = await fetch(`${api}/api/v1/health`);
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (e) {
    throw new Error(
      `The AMS API is not reachable at ${api} (${String(e)}). Start it with the demo seed (see web/README.md) or set E2E_API_URL.`,
      { cause: e },
    );
  }
}
