# syntax=docker/dockerfile:1
# Builds the Nuxt app (Nitro node preset). Multi-arch base image (works on Raspberry Pi / arm64).
FROM oven/bun:1-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json bunfig.toml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/config/tsconfig-base/base.json packages/config/tsconfig-base/base.json
# lightningcss (pulled in by Tailwind CSS 4 / @nuxt/ui) ships per-platform
# native binaries. Under QEMU-emulated arm64 builds, bun's libc detection can
# flake and fetch a corrupted tarball for a variant we don't even need
# (musl, on this glibc base) -- retry once with a clean cache before failing.
RUN bun install --frozen-lockfile || (rm -rf /root/.bun/install/cache && bun install --frozen-lockfile)

FROM deps AS build
COPY apps/web apps/web
COPY packages/shared-types packages/shared-types
WORKDIR /app/apps/web
ARG NUXT_PUBLIC_API_BASE
ENV NUXT_PUBLIC_API_BASE=${NUXT_PUBLIC_API_BASE}
RUN bun run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/web/.output /app/.output

EXPOSE 3000
USER bun
CMD ["bun", ".output/server/index.mjs"]
