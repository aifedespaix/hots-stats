<script setup lang="ts">
import { GAME_MODE_TAGS } from "~/utils/gameModeTags";

const gameModeStore = useGameModeStore();
const { activeTags } = storeToRefs(gameModeStore);
</script>

<template>
  <div
    class="flex items-center gap-1.5 overflow-x-auto"
    role="group"
    aria-label="Filtrer par mode de jeu"
  >
    <UButton
      v-for="tag in GAME_MODE_TAGS"
      :key="tag.key"
      size="xs"
      class="shrink-0 rounded-full px-3"
      :variant="activeTags.includes(tag.key) ? 'solid' : 'soft'"
      :color="activeTags.includes(tag.key) ? 'primary' : 'neutral'"
      :aria-pressed="activeTags.includes(tag.key)"
      @click="gameModeStore.toggleTag(tag.key)"
    >
      {{ tag.label }}
    </UButton>
  </div>
</template>
