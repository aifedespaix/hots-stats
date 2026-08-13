<script setup lang="ts">
/**
 * Compact FDP/PGM vote-count badges + "has notes" indicator for a battletag, read from the
 * shared annotations cache (usePlayerAnnotationsStore) -- counts and notes are aggregated
 * across the connected user and their accepted friends. The parent is responsible for having
 * called `fetchMany`/`refreshOne` for this battletag at some point -- this component only
 * renders whatever's already cached, it never fetches on its own, so dropping dozens of these
 * in a table doesn't fire dozens of requests.
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
    v-if="annotation && (annotation.fdpCount > 0 || annotation.pgmCount > 0 || entries.length > 0)"
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
      :title="`Marqué PGM par ${annotation.pgmCount} joueur(s)`"
    >
      <UIcon name="i-heroicons-star" class="h-3 w-3" />
      PGM · {{ annotation.pgmCount }}
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

    <UModal v-model="noteModalOpen">
      <div class="p-6" @click.stop>
        <h2 class="break-all font-heading text-lg font-semibold font-mono">{{ battletag }}</h2>

        <div v-if="entries.length > 1" class="mt-4">
          <label class="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Auteur</label>
          <USelectMenu
            v-model="selectedAuthorId"
            :options="authorOptions"
            value-attribute="value"
            option-attribute="label"
          />
        </div>

        <div v-if="selectedEntry" class="mt-4">
          <p class="text-xs font-medium uppercase tracking-wide text-muted">
            {{ selectedEntry.isMine ? `${selectedEntry.authorName} (moi)` : selectedEntry.authorName }}
          </p>
          <p class="mt-1 whitespace-pre-wrap text-sm text-foreground">{{ selectedEntry.note }}</p>
        </div>

        <div class="mt-6 flex justify-end">
          <UButton variant="ghost" @click="noteModalOpen = false">Fermer</UButton>
        </div>
      </div>
    </UModal>
  </span>
</template>
