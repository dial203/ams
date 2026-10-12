# AGENTS.md

Read [README.md](README.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.

## Rules

- `docs/API.md` is the contract between `api/` and the clients. Change it in the same commit as the code that changes the behaviour.
- `docs/FORMS.md` is normative for the form schema, expression language and evaluation. The Python engine (`api/app/forms/`) and the TypeScript engine (`packages/shared/src/expr`, `packages/shared/src/forms`) must both pass every case in `spec/`. When they disagree, add a spec case that pins the behaviour, then fix the engine that is wrong.
- Open Wearables is a separate service (`dial203/open-wearables`). Do not reach into its database; use its REST API through `api/app/integrations/open_wearables/`.
- Permissions are enforced in the API, never only in a client. Every org-scoped query filters by `org_id` and by the caller's visible athletes.
- Never commit secrets. Configuration comes from environment variables (`api/.env.example`).
- Metric and statistics code: missing data stays missing (no silent zero-fill unless the metric says `fill_zero`), and wearable baselines never mix sources.

## Commands

| | |
|---|---|
| API tests | `cd api && uv run pytest` (needs Postgres; see `api/README.md`) |
| API lint | `cd api && uv run ruff check . && uv run ruff format --check .` |
| JS install | `pnpm install` (root) |
| Shared tests | `pnpm --filter @ams/shared test` |
| Web | `pnpm --filter @ams/web dev` / `test` / `typecheck` / `build` |
| Mobile | `pnpm --filter @ams/mobile start` / `typecheck` / `test` |
