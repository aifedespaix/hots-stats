<script setup lang="ts">
const props = withDefaults(defineProps<{ columns?: 2 | 3 | 4 | 6 }>(), { columns: 3 });

// Static map so Tailwind's JIT scanner can detect the classes (a
// dynamically-built template string like `sm:grid-cols-${columns}` would not
// be picked up by the scanner).
const columnsClass: Record<2 | 3 | 4 | 6, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  6: "sm:grid-cols-6",
};

const gridClass = computed(() => columnsClass[props.columns]);
</script>

<template>
  <div class="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-4" :class="gridClass">
    <slot />
  </div>
</template>
