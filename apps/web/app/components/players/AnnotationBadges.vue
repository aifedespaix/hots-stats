<script setup lang="ts">
/**
 * Compact FDP/Sympa vote-count badges + average star rating + "has notes" indicator for a
 * battletag, read from the shared annotations cache (usePlayerAnnotationsStore) -- counts and
 * notes are aggregated across the connected user and their accepted friends. The parent is
 * responsible for having called `fetchMany`/`refreshOne` for this battletag at some point --
 * this component only renders whatever's already cached, it never fetches on its own, so
 * dropping dozens of these in a table doesn't fire dozens of requests.
 */
const props = defineProps<{ battletag: string }>();

const store = usePlayerAnnotationsStore();
const annotation = computed(() => store.annotationFor(props.battletag));
const entries = computed(() => annotation.value?.entries ?? []);

const noteModalOpen = ref(false);
const selectedAuthorId = ref<string | undefined>(undefined);

const authorOptions = computed(() =>
  entries.value.map((entry) => ({
    label: entry.isMine ? `${entry.authorName} (moi)` : entry.authorName,
    value: entry.authorId,
  })),
);

const selectedEntry = computed(
  () => entries.value.find((entry) => entry.authorId === selectedAuthorId.value) ?? entries.value[0] ?? null,
);

function openNoteModal() {
  selectedAuthorId.value = entries.value[0]?.authorId;
  noteModalOpen.value = true;
}
</script>

<template>
  <span
    v-if="
      annotation &&
      (annotation.fdpCount > 0 || annotation.pgmCount > 0 || annotation.ratingCount > 0 || entries.length > 0)
    "
    class="inline-flex items-center gap-1"
  >
    <span
      v-if="annotation.fdpCount > 0"
      class="inline-flex items-center gap-0.5 rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger"
      :title="`Marqué FDP par ${annotation.fdpCount} joueur(s)`"
    >
      <UIcon name="i-heroicons-face-frown" class="h-3 w-3" />
      FDP · {{ annotation.fdpCount }}
    </span>
    <span
      v-if="annotation.pgmCount > 0"
      class="inline-flex items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent"
      :title="`Marqué sympa par ${annotation.pgmCount} joueur(s)`"
    >
      <UIcon name="i-heroicons-face-smile" class="h-3 w-3" />
      Sympa · {{ annotation.pgmCount }}
    </span>
    <span
      v-if="annotation.ratingCount > 0"
      class="inline-flex items-center gap-1 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-semibold text-foreground"
      :title="`Note moyenne ${annotation.ratingAverage} / 5 (${annotation.ratingCount} vote(s))`"
    >
      <UIcon name="i-heroicons-star-solid" class="h-3 w-3 text-accent" />
      {{ annotation.ratingAverage }} · {{ annotation.ratingCount }}
    </span>
    <button
      v-if="entries.length > 0"
      type="button"
      class="flex h-4 items-center gap-0.5 shrink-0 text-muted transition-colors hover:text-foreground"
      :title="`${entries.length} note(s)`"
      @click.stop.prevent="openNoteModal"
    >
      <UIcon name="i-heroicons-document-text" class="h-3.5 w-3.5" />
      <span v-if="entries.length > 1" class="text-[10px] font-semibold">{{ entries.length }}</span>
    </button>

    <UModal v-model:open="noteModalOpen" :title="battletag ?? undefined">
      <template #body>
        <div class="space-y-4" @click.stop>
          <div v-if="entries.length > 1">
            <label class="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Auteur</label>
            <USelectMenu
              v-model="selectedAuthorId"
              :items="authorOptions"
              value-key="value"
              label-key="label"
            />
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
            <UButton variant="ghost" @click="noteModalOpen = false">Fermer</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </span>
</template>
