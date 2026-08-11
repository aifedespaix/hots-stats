# syntax=docker/dockerfile:1
# Builds the Hono API on Bun. Multi-arch base image (works on Raspberry Pi / arm64).
FROM oven/bun:1-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json bunfig.toml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/config/tsconfig-base/base.json packages/config/tsconfig-base/base.json
RUN bun install --frozen-lockfile

FROM deps AS build
COPY apps/api apps/api
COPY packages/db packages/db
COPY packages/shared-types packages/shared-types
WORKDIR /app/apps/api
RUN bun run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/packages/db /app/packages/db
COPY --from=build /app/packages/shared-types /app/packages/shared-types

EXPOSE 3001
USER bun
CMD ["bun", "run", "apps/api/dist/index.js"]
