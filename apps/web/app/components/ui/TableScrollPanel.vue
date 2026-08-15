<script setup lang="ts">
/**
 * Wraps a `UiDataTable` (or any list/table content) in a capped-height
 * scroll region: the panel's own height stops growing past `maxHeight`
 * and only its inner content scrolls, keeping surrounding page chrome
 * (filters, header, footer) in place instead of pushing the whole page
 * into a long scroll. Every "dashboard grid" list page should reach for
 * this instead of re-implementing the max-height/overflow pair inline.
 */
withDefaults(defineProps<{ maxHeight?: string }>(), {
  maxHeight: "70vh",
});
</script>

<template>
  <div class="overflow-y-auto rounded-lg" :style="{ maxHeight }">
    <slot />
  </div>
</template>
