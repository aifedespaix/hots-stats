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
    :open="modelValue"
    :ui="{ content: 'sm:max-w-3xl', body: 'max-h-[85vh] overflow-y-auto' }"
    @update:open="(value: boolean) => $emit('update:modelValue', value)"
  >
    <template #body>
      <PlayersProfileDetail v-if="props.battletag" :battletag="props.battletag" />
    </template>
  </UModal>
</template>
