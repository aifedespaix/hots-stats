<script setup lang="ts">
import { GAME_MODE_TAGS } from "~/utils/gameModeTags";

const gameModeStore = useGameModeStore();
const { activeTags } = storeToRefs(gameModeStore);

// The store's persisted `activeTags` (localStorage-only, see useGameModeStore)
// is restored synchronously while Vue is still hydrating this component, so
// by the time our own render runs the value is already correct -- but Vue's
// hydration diffing keeps trusting the server-rendered attributes on these
// buttons anyway and never patches them, leaving e.g. an active "QM" tag
// visually unpressed after a refresh even though the store is right. Forcing
// a fresh client-side render for this small subtree once mounted sidesteps
// that stale-hydration mismatch instead of trying to out-guess it.
const renderKey = ref(0);
onMounted(() => {
  renderKey.value++;
});
</script>

<template>
  <div
    :key="renderKey"
    class="flex items-center gap-1.5 overflow-x-auto"
    role="group"
    aria-label="Filtrer par mode de jeu"
  >
    <UButton
      v-for="tag in GAME_MODE_TAGS"
      :key="tag.key"
      size="xs"
      class="shrink-0 rounded-full px-2 text-[10px] sm:px-3 sm:text-xs"
      :variant="activeTags.includes(tag.key) ? 'solid' : 'soft'"
      :color="activeTags.includes(tag.key) ? 'primary' : 'neutral'"
      :aria-pressed="activeTags.includes(tag.key)"
      @click="gameModeStore.toggleTag(tag.key)"
    >
      {{ tag.label }}
    </UButton>
  </div>
</template>
