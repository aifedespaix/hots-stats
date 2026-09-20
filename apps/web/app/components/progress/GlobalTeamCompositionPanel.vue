<script setup lang="ts">
import type { ContextResponse } from "@hots-stats/shared-types";

const props = withDefaults(
  defineProps<{
    context?: ContextResponse | null;
    loading?: boolean;
    error?: boolean;
    /** Forwarded to `UiPanel`: false lets the panel grow with the page instead of scrolling on its own. */
    scrollable?: boolean;
  }>(),
  { context: null, loading: false, error: false, scrollable: true },
);

/** Global responses carry this dimension alone (the community has no subject
 * for the other five), so there is nothing to fall back to. */
const breakdown = computed(
  () => props.context?.breakdowns.find((entry) => entry.dimension === "teamComposition") ?? null,
);

const matches = computed(() => props.context?.matches ?? 0);
const isEmpty = computed(() => !props.loading && !props.error && matches.value === 0);
</script>

<template>
  <UiPanel title="Composition d'équipe (toute l'app)" :count="matches" :scrollable="scrollable">
    <UiStateCard v-if="loading" state="loading" size="sm" />
    <UiStateCard v-else-if="error" state="error" size="sm" message="Impossible de charger les compositions." />
    <UiStateCard
      v-else-if="isEmpty"
      state="empty"
      size="sm"
      message="Aucune partie pour cette période — les compositions apparaîtront après quelques games."
    />
    <div v-else class="space-y-3">
      <p class="text-sm text-muted">
        Chaque équipe de chaque partie compte une fois : le winrate est la part de ces équipes qui gagnent avec
        cette composition, sur {{ matches }} partie(s).
      </p>
      <ProgressTeamCompositionTable :breakdown="breakdown" unit-label="Équipes" />
    </div>
  </UiPanel>
</template>
