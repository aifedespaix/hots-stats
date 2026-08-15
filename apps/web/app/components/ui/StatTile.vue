<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    value: string;
    sublabel?: string;
    tone?: "default" | "success" | "danger";
  }>(),
  { tone: "default", sublabel: undefined },
);
</script>

<template>
  <div class="rounded-lg border border-border bg-surface p-3 sm:p-4">
    <div class="flex items-center gap-1">
      <p class="text-xs uppercase tracking-wide text-muted">{{ label }}</p>
      <UTooltip v-if="$slots.tooltip" :popper="{ placement: 'top' }">
        <template #text>
          <div class="max-w-xs space-y-1.5 py-0.5 text-left text-xs leading-relaxed">
            <slot name="tooltip" />
          </div>
        </template>
        <UIcon
          name="i-heroicons-information-circle"
          class="h-3.5 w-3.5 shrink-0 cursor-help text-muted/70 transition-colors hover:text-brand"
        />
      </UTooltip>
    </div>
    <div
      class="mt-2 break-words font-mono text-lg font-semibold sm:text-2xl"
      :class="TONE_TEXT_CLASS[tone]"
    >
      <slot>{{ value }}</slot>
    </div>
    <p v-if="sublabel" class="mt-1 text-xs text-muted">{{ sublabel }}</p>
  </div>
</template>
