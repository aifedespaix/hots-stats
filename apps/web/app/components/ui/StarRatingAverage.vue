<script setup lang="ts">
/**
 * Read-only average star rating, rounded to the nearest half-star (e.g. 4.6
 * displays as 4 full stars + 1 half star, the rest grayed out). Distinct
 * from `UiStarRating`, which only ever renders whole stars for a single
 * viewer's own 1-5 pick.
 */
const props = withDefaults(defineProps<{ average: number | null; count?: number; size?: string }>(), {
  count: 0,
  size: "h-4 w-4",
});

const rounded = computed(() => (props.average === null ? 0 : Math.round(props.average * 2) / 2));

function starFill(star: number): "full" | "half" | "empty" {
  if (rounded.value >= star) return "full";
  if (rounded.value >= star - 0.5) return "half";
  return "empty";
}
</script>

<template>
  <span class="inline-flex items-center gap-1.5">
    <span v-if="average !== null" class="inline-flex items-center gap-0.5">
      <span v-for="star in 5" :key="star" class="relative inline-block shrink-0" :class="size">
        <UIcon name="i-heroicons-star" class="absolute inset-0 h-full w-full text-muted/40" />
        <span
          v-if="starFill(star) !== 'empty'"
          class="absolute inset-0 overflow-hidden"
          :style="{ width: starFill(star) === 'half' ? '50%' : '100%' }"
        >
          <UIcon name="i-heroicons-star-solid" class="h-full w-full text-accent" />
        </span>
      </span>
    </span>
    <span v-if="average !== null" class="whitespace-nowrap text-xs text-muted">
      {{ average.toFixed(1) }} ({{ count }})
    </span>
    <span v-else class="text-xs text-muted">Pas encore noté</span>
  </span>
</template>
