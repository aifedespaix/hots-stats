<script setup lang="ts">
import type { PlayerAnnotationEntry } from "@hots-stats/shared-types";

/**
 * "Commentaires" column trigger: opens a modal listing every note left on
 * this battletag by the viewer or their friends. Shares the same entry
 * shape/modal layout as `PlayersAnnotationBadges`, split out on its own so
 * the players table can give it a dedicated column instead of a small inline
 * icon next to the battletag.
 */
const props = defineProps<{ battletag: string; entries: PlayerAnnotationEntry[] }>();

const modalOpen = ref(false);
const selectedAuthorId = ref<string | undefined>(undefined);

const authorOptions = computed(() =>
  props.entries.map((entry) => ({
    label: entry.isMine ? `${entry.authorName} (moi)` : entry.authorName,
    value: entry.authorId,
  })),
);

const selectedEntry = computed(
  () => props.entries.find((entry) => entry.authorId === selectedAuthorId.value) ?? props.entries[0] ?? null,
);

function open() {
  selectedAuthorId.value = props.entries[0]?.authorId;
  modalOpen.value = true;
}
</script>

<template>
  <span v-if="entries.length === 0" class="text-xs text-muted">-</span>
  <button
    v-else
    type="button"
    class="inline-flex items-center gap-1 rounded-full bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-brand/15 hover:text-brand"
    @click.stop.prevent="open"
  >
    <UIcon name="i-heroicons-document-text" class="h-3.5 w-3.5" />
    {{ entries.length }} note{{ entries.length > 1 ? "s" : "" }}
  </button>

  <UModal v-model:open="modalOpen" :title="battletag ?? undefined">
    <template #body>
      <div class="space-y-4" @click.stop>
        <div v-if="entries.length > 1">
          <label class="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Auteur</label>
          <USelectMenu v-model="selectedAuthorId" :items="authorOptions" value-key="value" label-key="label" />
        </div>

        <div v-if="selectedEntry" class="space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs font-medium uppercase tracking-wide text-muted">
              {{ selectedEntry.isMine ? `${selectedEntry.authorName} (moi)` : selectedEntry.authorName }}
            </p>
            <UiStarRating v-if="selectedEntry.rating" :model-value="selectedEntry.rating" size="h-3.5 w-3.5" />
          </div>
          <div class="flex gap-2 text-[10px] font-semibold uppercase tracking-wide">
            <span v-if="selectedEntry.isFdp" class="text-danger">FDP</span>
            <span v-if="selectedEntry.isPgm" class="text-accent">Sympa</span>
          </div>
          <p class="whitespace-pre-wrap text-sm text-foreground">{{ selectedEntry.note }}</p>
        </div>

        <div class="flex justify-end">
          <UButton variant="ghost" @click="modalOpen = false">Fermer</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
