<script setup lang="ts">
defineProps<{
  filtersDefault: boolean;
  sortDefault: boolean;
}>();

defineEmits<{
  (e: "reset-filters"): void;
  (e: "reset-sort"): void;
}>();
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <UButton
      size="xs"
      color="gray"
      variant="soft"
      icon="i-heroicons-x-mark"
      :disabled="filtersDefault"
      @click="$emit('reset-filters')"
    >
      Réinitialiser les filtres
    </UButton>
    <UButton
      size="xs"
      color="gray"
      variant="soft"
      icon="i-heroicons-arrows-up-down"
      :disabled="sortDefault"
      @click="$emit('reset-sort')"
    >
      Réinitialiser le tri
    </UButton>
  </div>
</template>
