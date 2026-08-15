<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    mapId: string;
    name: string;
    /** Aspect ratio class applied to the wrapper -- callers pick the shape (card thumbnail vs. wide banner). */
    aspect?: string;
    /** Rounding applied to the wrapper, matching whichever card convention the caller uses. */
    rounded?: string;
  }>(),
  {
    aspect: "aspect-video",
    rounded: "rounded-lg",
  },
);

// Reset when the underlying image changes so a previously-broken map
// doesn't stay stuck on the fallback if the same component instance gets
// reused for a different mapId (e.g. a v-for whose list is patched
// in-place rather than fully re-keyed).
const broken = ref(false);
watch(() => props.mapId, () => (broken.value = false));

const src = computed(() => `/images/maps/thumb/${props.mapId}.webp`);
</script>

<template>
  <div class="relative w-full overflow-hidden" :class="[aspect, rounded]">
    <img
      v-if="!broken"
      :src="src"
      :alt="name"
      loading="lazy"
      decoding="async"
      class="h-full w-full object-cover"
      @error="broken = true"
    >
    <div v-else class="flex h-full w-full items-center justify-center border border-border bg-muted/10 text-muted">
      <UIcon name="i-heroicons-map" class="h-8 w-8" />
    </div>
  </div>
</template>
