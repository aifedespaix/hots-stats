#!/usr/bin/env bash
set -euo pipefail

# Opens Drizzle Studio (UI to browse/edit prod data) against the Pi's
# Postgres without ever exposing it beyond loopback. Postgres is bound to
# 127.0.0.1:5432 on the Pi (see docker-compose.backend.yml) -- this script
# SSH-tunnels that loopback port to your machine, then points `drizzle-kit
# studio` at the tunnel.
#
# Usage:
#   SSH_HOST=user@raspberrypi.local \
#   POSTGRES_USER=... POSTGRES_PASSWORD=... POSTGRES_DB=... \
#   bun run studio:remote

: "${SSH_HOST:?Set SSH_HOST=user@host (the Pi running Dokploy)}"
: "${POSTGRES_USER:?Set POSTGRES_USER (same value as on the Pi)}"
: "${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD (same value as on the Pi)}"
: "${POSTGRES_DB:?Set POSTGRES_DB (same value as on the Pi)}"

LOCAL_PORT="${LOCAL_PORT:-5433}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ssh -N -L "${LOCAL_PORT}:127.0.0.1:5432" "$SSH_HOST" &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null' EXIT

# Give the tunnel a moment to come up before drizzle-kit connects.
for _ in $(seq 1 20); do
  if (exec 3<>"/dev/tcp/127.0.0.1/${LOCAL_PORT}") 2>/dev/null; then
    exec 3<&- 3>&-
    break
  fi
  sleep 0.5
done

DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${LOCAL_PORT}/${POSTGRES_DB}" \
  bunx drizzle-kit studio --config "${SCRIPT_DIR}/../drizzle.config.ts"
