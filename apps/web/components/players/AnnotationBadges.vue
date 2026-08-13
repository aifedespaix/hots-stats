<script setup lang="ts">
/**
 * Compact FDP/PGM badges + "has a note" indicator for a battletag, read from
 * the shared annotations cache (usePlayerAnnotationsStore). The parent is
 * responsible for having called `fetchMany`/`fetchOne` for this battletag at
 * some point -- this component only renders whatever's already cached, it
 * never fetches on its own, so dropping dozens of these in a table doesn't
 * fire dozens of requests.
 */
const props = defineProps<{ battletag: string }>();

const store = usePlayerAnnotationsStore();
const annotation = computed(() => store.annotationFor(props.battletag));
const hasNote = computed(() => Boolean(annotation.value?.note.trim()));

const noteModalOpen = ref(false);
</script>

<template>
  <span v-if="annotation && (annotation.isFdp || annotation.isPgm || hasNote)" class="inline-flex items-center gap-1">
    <span
      v-if="annotation.isFdp"
      class="inline-flex items-center gap-0.5 rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger"
      title="Marqué FDP"
    >
      <UIcon name="i-heroicons-face-frown" class="h-3 w-3" />
      FDP
    </span>
    <span
      v-if="annotation.isPgm"
      class="inline-flex items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent"
      title="Marqué PGM"
    >
      <UIcon name="i-heroicons-star" class="h-3 w-3" />
      PGM
    </span>
    <button
      v-if="hasNote"
      type="button"
      class="flex h-4 w-4 shrink-0 items-center justify-center text-muted transition-colors hover:text-foreground"
      title="Voir la note"
      @click.stop.prevent="noteModalOpen = true"
    >
      <UIcon name="i-heroicons-information-circle" class="h-3.5 w-3.5" />
    </button>

    <UModal v-model="noteModalOpen">
      <div class="p-6" @click.stop>
        <h2 class="break-all font-heading text-lg font-semibold font-mono">{{ battletag }}</h2>
        <p class="mt-3 whitespace-pre-wrap text-sm text-foreground">{{ annotation.note }}</p>
        <div class="mt-6 flex justify-end">
          <UButton variant="ghost" @click="noteModalOpen = false">Fermer</UButton>
        </div>
      </div>
    </UModal>
  </span>
</template>
