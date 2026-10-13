#!/usr/bin/env bash
# Builds the in-browser web demo (what .github/workflows/pages.yml deploys) into web/dist.
#
#   DATABASE_URL=postgresql+psycopg://postgres@localhost:5432/ams_demo scripts/build-demo.sh
#
# DATABASE_URL must point at an empty, disposable database: it is migrated, seeded with
# `seed-demo` and read by `export-demo`, which writes web/public/demo/<role>.json. Set
# SKIP_SEED=1 to export from a database that already holds the demo seed.
# Then serve web/dist from any path, e.g.:
#   pnpm --filter @ams/web exec vite preview --base /ams/     # http://localhost:4173/ams/
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to an empty Postgres database (it gets migrated and seeded)}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DATABASE_URL
export AMS_SECRET_KEY="${AMS_SECRET_KEY:-$(python3 -c 'import secrets; print(secrets.token_hex(32))')}"

cd "$root/api"
uv sync --frozen
uv run alembic upgrade head
if [ "${SKIP_SEED:-0}" != "1" ]; then
  uv run python -m app.cli seed-demo
fi
rm -rf "$root/web/public/demo"
uv run python -m app.cli export-demo --out "$root/web/public/demo"

cd "$root"
pnpm install --frozen-lockfile
pnpm --filter @ams/web build:demo
echo "Demo built in web/dist (fixtures from web/public/demo)."
