<script setup lang="ts">
withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmIcon?: string;
    /** Défaut true : bouton de confirmation en color="error". */
    danger?: boolean;
    loading?: boolean;
    disabled?: boolean;
  }>(),
  {
    confirmLabel: "Confirmer",
    cancelLabel: "Annuler",
    confirmIcon: undefined,
    danger: true,
    loading: false,
    disabled: false,
  },
);

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "confirm"): void;
}>();
</script>

<template>
  <UModal :open="open" :title="title" @update:open="emit('update:open', $event)">
    <template #body>
      <div class="space-y-2">
        <slot />
      </div>
      <div class="mt-6 flex justify-end gap-2">
        <UButton variant="ghost" icon="i-heroicons-x-mark" @click="emit('update:open', false)">
          {{ cancelLabel }}
        </UButton>
        <UButton
          :color="danger ? 'error' : 'primary'"
          :icon="confirmIcon"
          :disabled="disabled"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
