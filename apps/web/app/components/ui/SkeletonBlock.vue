<script setup lang="ts">
/**
 * Bare "pulse" placeholder box. Deliberately unopinionated about size/shape/color --
 * callers compose the actual skeleton layout (single bar, grid of tiles,
 * stacked lines...) by passing height/width/rounded/bg classes via `class`.
 */
defineOptions({ inheritAttrs: false });
</script>

<template>
  <div class="animate-pulse" v-bind="$attrs" />
</template>
