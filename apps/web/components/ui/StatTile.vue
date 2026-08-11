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
  <div class="rounded-lg border border-border bg-surface p-4">
    <p class="text-xs uppercase tracking-wide text-muted">{{ label }}</p>
    <p
      class="mt-2 font-mono text-2xl font-semibold"
      :class="{
        'text-success': tone === 'success',
        'text-danger': tone === 'danger',
        'text-foreground': tone === 'default',
      }"
    >
      {{ value }}
    </p>
    <p v-if="sublabel" class="mt-1 text-xs text-muted">{{ sublabel }}</p>
  </div>
</template>
