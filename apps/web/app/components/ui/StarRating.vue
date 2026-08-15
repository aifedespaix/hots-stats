<script setup lang="ts">
/**
 * 1-5 star rating: read-only display (badges, notes modal, "my ratings" summary) or an
 * interactive picker (annotation edit form) depending on `readonly`. Clicking the star that's
 * already selected clears the rating, so it stays possible to go back to "not rated".
 */
const props = withDefaults(defineProps<{ modelValue: number | null; readonly?: boolean; size?: string }>(), {
  readonly: true,
  size: "h-4 w-4",
});

const emit = defineEmits<{ (e: "update:modelValue", value: number | null): void }>();

function isFilled(star: number): boolean {
  return (props.modelValue ?? 0) >= star;
}

function onClick(star: number) {
  if (props.readonly) return;
  emit("update:modelValue", props.modelValue === star ? null : star);
}
</script>

<template>
  <span class="inline-flex items-center gap-0.5">
    <button
      v-for="star in 5"
      :key="star"
      type="button"
      :tabindex="props.readonly ? -1 : 0"
      class="text-accent"
      :class="props.readonly ? 'cursor-default' : 'cursor-pointer transition-transform hover:scale-110'"
      @click.stop.prevent="onClick(star)"
    >
      <UIcon :name="isFilled(star) ? 'i-heroicons-star-solid' : 'i-heroicons-star'" :class="size" />
    </button>
  </span>
</template>
