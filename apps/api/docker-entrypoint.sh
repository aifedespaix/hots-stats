#!/bin/sh
set -e

cd /app/packages/db
bun run src/migrate.ts
cd /app

exec bun run apps/api/dist/index.js
