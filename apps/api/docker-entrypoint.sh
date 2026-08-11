#!/bin/sh
set -e

cd /app/packages/db
bun run src/migrate.ts
# Safe to rerun on every deploy: onConflictDoNothing leaves existing rows
# (and any custom iconUrl/role edits) untouched, it only fills gaps.
bun run src/seed.ts
cd /app

exec bun run apps/api/dist/index.js
