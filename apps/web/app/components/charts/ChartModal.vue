<script setup lang="ts">
/**
 * Generic "épurée" chart modal shell: header + fixed-height body with
 * loading/error/empty states, chart content provided via the default slot.
 * Every chart-specific modal in `components/charts/` wraps this instead of
 * re-implementing the same UModal boilerplate, so any future chart (here or
 * on another page) gets the same look for free.
 */
withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    description?: string;
    pending?: boolean;
    errored?: boolean;
    empty?: boolean;
    emptyText?: string;
    errorText?: string;
  }>(),
  {
    description: undefined,
    pending: false,
    errored: false,
    empty: false,
    emptyText: "Aucune donnée pour ces filtres.",
    errorText: "Impossible de charger le graphique.",
  },
);

defineEmits<{ (e: "update:modelValue", value: boolean): void }>();
</script>

<template>
  <UModal :open="modelValue" @update:open="(value: boolean) => $emit('update:modelValue', value)">
    <div class="p-6">
      <h2 class="font-heading text-lg font-semibold">{{ title }}</h2>
      <p v-if="description" class="mt-1 text-sm text-muted">{{ description }}</p>

      <slot name="extra" />

      <div class="mt-4 h-72">
        <p v-if="pending" class="flex h-full items-center justify-center text-sm text-muted">Chargement…</p>
        <p v-else-if="errored" class="flex h-full items-center justify-center text-sm text-danger">
          {{ errorText }}
        </p>
        <p v-else-if="empty" class="flex h-full items-center justify-center text-sm text-muted">
          {{ emptyText }}
        </p>
        <slot v-else />
      </div>
    </div>
  </UModal>
</template>
