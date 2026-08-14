<script setup lang="ts">
/** Generic icon + label + value row, used for the compact secondary stats inside a `StatsStatCard` (e.g. winrate, KDA). */
withDefaults(
  defineProps<{
    icon: string;
    label: string;
    value: string;
    tone?: "default" | "success" | "danger";
  }>(),
  { tone: "default" },
);
</script>

<template>
  <div class="flex items-center justify-between gap-2 rounded-lg bg-background/60 px-2.5 py-1.5">
    <span class="flex min-w-0 items-center gap-1.5 text-xs text-muted">
      <UIcon :name="icon" class="h-3.5 w-3.5 shrink-0" />
      <span class="truncate">{{ label }}</span>
    </span>
    <span class="shrink-0 font-mono text-sm font-semibold" :class="TONE_TEXT_CLASS[tone]">
      {{ value }}
    </span>
  </div>
</template>
