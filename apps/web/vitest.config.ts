import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Deliberately plain `vitest` (no `@nuxt/test-utils`/Nuxt runtime bootstrap):
// the only files tested so far are pure composable logic with an explicit
// `vue` import (see useHeatmapSync.ts's own comment on why), so a full Nuxt
// test environment would only add startup cost with no benefit. Revisit if
// a future test needs Nuxt-specific runtime features (route composables,
// server handlers, ...).
export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
