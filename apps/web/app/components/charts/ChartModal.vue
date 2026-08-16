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
  <UModal
    :open="modelValue"
    :title="title"
    :description="description"
    @update:open="(value: boolean) => $emit('update:modelValue', value)"
  >
    <template #body>
      <slot name="extra" />

      <div class="mt-4 h-72">
        <div v-if="pending || errored || empty" class="flex h-full items-center justify-center">
          <UiStateCard
            :state="pending ? 'loading' : errored ? 'error' : 'empty'"
            :message="errored ? errorText : empty ? emptyText : undefined"
            size="sm"
          />
        </div>
        <slot v-else />
      </div>
    </template>
  </UModal>
</template>
