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
</script>

<template>
  <span
    v-if="
      annotation &&
      (annotation.fdpCount > 0 || annotation.pgmCount > 0 || annotation.ratingCount > 0 || entries.length > 0)
    "
    class="inline-flex items-center gap-1"
  >
    <PlayersBehaviorBadges :fdp-count="annotation.fdpCount" :pgm-count="annotation.pgmCount" />
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
      @click.stop.prevent="noteModalOpen = true"
    >
      <UIcon name="i-heroicons-document-text" class="h-3.5 w-3.5" />
      <span v-if="entries.length > 1" class="text-[10px] font-semibold">{{ entries.length }}</span>
    </button>

    <PlayersNoteModal v-model:open="noteModalOpen" :battletag="battletag" :entries="entries" />
  </span>
</template>
