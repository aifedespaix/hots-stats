<script setup lang="ts">
/**
 * Generic KPI card shell used by the "Dashboard" section: colored gradient
 * frame, icon badge, an optional headline value, and a slot for whatever
 * rich content the card needs (a mini-stat row, a ranked list, ...). Kept
 * free of any matches-specific logic so it's trivially reusable on other
 * pages (e.g. the Diagnostic page).
 */
withDefaults(
  defineProps<{
    title: string;
    icon: string;
    tone?: "primary" | "accent" | "success" | "danger";
    value?: string;
    valueSub?: string;
    loading?: boolean;
  }>(),
  { tone: "primary", value: undefined, valueSub: undefined, loading: false },
);

const toneClasses: Record<string, string> = {
  primary: "border-brand/25 bg-gradient-to-br from-brand/10 via-surface to-surface hover:border-brand/40",
  accent: "border-accent/25 bg-gradient-to-br from-accent/10 via-surface to-surface hover:border-accent/40",
  success: "border-success/25 bg-gradient-to-br from-success/10 via-surface to-surface hover:border-success/40",
  danger: "border-danger/25 bg-gradient-to-br from-danger/10 via-surface to-surface hover:border-danger/40",
};

const iconToneClasses: Record<string, string> = {
  primary: "bg-brand/15 text-brand",
  accent: "bg-accent/15 text-accent",
  success: "bg-success/15 text-success",
  danger: "bg-danger/15 text-danger",
};
</script>

<template>
  <div
    class="group relative overflow-hidden rounded-xl border p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg sm:p-5"
    :class="toneClasses[tone]"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium uppercase tracking-wide text-muted">{{ title }}</p>
        <UiSkeletonBlock v-if="loading" class="mt-2 h-8 w-16 rounded bg-border/50" />
        <p v-else-if="value !== undefined" class="mt-1 truncate font-heading text-2xl font-bold leading-none sm:text-3xl">
          {{ value }}
        </p>
        <p v-if="!loading && valueSub" class="mt-1.5 truncate text-xs text-muted">{{ valueSub }}</p>
      </div>
      <div
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-110"
        :class="iconToneClasses[tone]"
      >
        <UIcon :name="icon" class="h-5 w-5" />
      </div>
    </div>

    <div class="mt-3.5">
      <div v-if="loading" class="space-y-1.5">
        <UiSkeletonBlock class="h-6 w-full rounded bg-border/40" />
        <UiSkeletonBlock class="h-6 w-full rounded bg-border/40" />
        <UiSkeletonBlock class="h-6 w-2/3 rounded bg-border/40" />
      </div>
      <slot v-else />
    </div>
  </div>
</template>
