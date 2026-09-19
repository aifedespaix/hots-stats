<script setup lang="ts">
/**
 * Win/loss result cell shared by every UiDataTable "result" column. The
 * glyph is decorative (aria-hidden) because the French label already carries
 * the meaning -- the glyph is the redundant cue for colour-blind readers.
 */
defineProps<{ won: boolean }>();
</script>

<template>
  <span class="inline-flex items-center gap-1" :class="TONE_TEXT_CLASS[won ? 'success' : 'danger']">
    <span aria-hidden="true">{{ outcomeGlyph(won) }}</span>
    <span>{{ won ? "Victoire" : "Défaite" }}</span>
  </span>
</template>
