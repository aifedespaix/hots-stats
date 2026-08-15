<script setup lang="ts">
import type { PlayerAnnotationEntry } from "@hots-stats/shared-types";

/**
 * "Commentaires" column trigger: opens a modal listing every note left on
 * this battletag by the viewer or their friends. Shares the same entry
 * shape/modal (PlayersNoteModal) as `PlayersAnnotationBadges`, split out on
 * its own so the players table can give it a dedicated column instead of a
 * small inline icon next to the battletag.
 */
defineProps<{ battletag: string; entries: PlayerAnnotationEntry[] }>();

const modalOpen = ref(false);
</script>

<template>
  <span v-if="entries.length === 0" class="text-xs text-muted">-</span>
  <button
    v-else
    type="button"
    class="inline-flex items-center gap-1 rounded-full bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-brand/15 hover:text-brand"
    @click.stop.prevent="modalOpen = true"
  >
    <UIcon name="i-heroicons-document-text" class="h-3.5 w-3.5" />
    {{ entries.length }} note{{ entries.length > 1 ? "s" : "" }}
  </button>

  <PlayersNoteModal v-model:open="modalOpen" :battletag="battletag" :entries="entries" />
</template>
