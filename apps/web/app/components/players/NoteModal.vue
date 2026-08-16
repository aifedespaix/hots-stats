<script setup lang="ts">
import type { PlayerAnnotationEntry } from "@hots-stats/shared-types";

/**
 * Corps de la modale "notes" partagé entre PlayersAnnotationBadges (icône
 * compacte) et PlayersNotesButton (bouton pill) -- sélecteur d'auteur +
 * affichage de la note sélectionnée, identique dans les deux contextes.
 */
const props = defineProps<{
  open: boolean;
  battletag: string;
  entries: PlayerAnnotationEntry[];
}>();

const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const selectedAuthorId = ref<string | undefined>(undefined);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) selectedAuthorId.value = props.entries[0]?.authorId;
  },
);

const authorOptions = computed(() =>
  props.entries.map((entry) => ({
    label: entry.isMine ? `${entry.authorName} (moi)` : entry.authorName,
    value: entry.authorId,
  })),
);

const selectedEntry = computed(
  () => props.entries.find((entry) => entry.authorId === selectedAuthorId.value) ?? props.entries[0] ?? null,
);
</script>

<template>
  <UModal :open="open" :title="battletag ?? undefined" @update:open="emit('update:open', $event)">
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
          <UButton variant="ghost" @click="emit('update:open', false)">Fermer</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
