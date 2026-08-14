<script setup lang="ts">
import type { HeroStatsScope } from "@hots-stats/shared-types";

/**
 * Visually flags a block of stats as "Statistique Globale" (every player's
 * matches, not just the connected account's) so the two scopes the app can
 * show side by side -- personal vs. app-wide -- are never confused for one
 * another. Purely presentational: it doesn't fetch or filter anything, it
 * just wraps whatever content a page already rendered for `scope="global"`.
 *
 * Renders its slot untouched (no border/tint/badge) when `scope` is
 * "personal", so wrapping every stats block unconditionally --
 * `<UiGlobalScopeBadge :scope="scope"><UiStatTile ... /></UiGlobalScopeBadge>`
 * -- is safe: the violet treatment only ever appears for data that's
 * genuinely app-wide.
 */
const props = withDefaults(
  defineProps<{
    scope: HeroStatsScope;
    /** Badge text; override for a more specific legend than the generic default. */
    label?: string;
    /** Tighter padding/badge for use inside small spaces (tooltips, table cells). */
    dense?: boolean;
  }>(),
  { label: "Statistique Globale", dense: false },
);

const isGlobal = computed(() => props.scope === "global");
</script>

<template>
  <div v-if="isGlobal" class="relative rounded-lg border border-brand/40 bg-brand/10" :class="dense ? 'p-2' : 'p-3'">
    <span
      class="absolute -top-2.5 left-3 inline-flex items-center gap-1 rounded-full border border-brand/40 bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand"
    >
      <UIcon name="i-heroicons-globe-alt" class="h-3 w-3" />
      {{ label }}
    </span>
    <slot />
  </div>
  <slot v-else />
</template>
