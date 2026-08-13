<script setup lang="ts">
/**
 * Wraps `PlayersProfileDetail` in a modal so advanced stats (real winrate,
 * favorite heroes, shared history...) can be checked from anywhere -- the
 * live draft in particular -- without leaving the current screen.
 */
const props = defineProps<{ modelValue: boolean; battletag: string | null }>();
defineEmits<{ (e: "update:modelValue", value: boolean): void }>();
</script>

<template>
  <UModal
    :model-value="modelValue"
    :ui="{ width: 'sm:max-w-3xl' }"
    @update:model-value="(value) => $emit('update:modelValue', value as boolean)"
  >
    <div class="max-h-[85vh] overflow-y-auto p-4 sm:p-6">
      <PlayersProfileDetail v-if="props.battletag" :battletag="props.battletag" />
    </div>
  </UModal>
</template>
