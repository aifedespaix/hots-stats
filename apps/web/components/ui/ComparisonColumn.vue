<script setup lang="ts">
withDefaults(defineProps<{ title: string; accent: "brand" | "accent"; lowSampleWarning?: boolean }>(), {
  lowSampleWarning: false,
});

// Static maps so Tailwind's JIT scanner can detect the classes.
const borderClass: Record<"brand" | "accent", string> = {
  brand: "border-l-brand",
  accent: "border-l-accent",
};
const textClass: Record<"brand" | "accent", string> = {
  brand: "text-brand",
  accent: "text-accent",
};
</script>

<template>
  <div>
    <div class="mb-2 flex items-center gap-2">
      <p class="text-xs font-semibold uppercase tracking-wide" :class="textClass[accent]">{{ title }}</p>
      <span
        v-if="lowSampleWarning"
        class="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted"
        title="Moins de 5 parties jouées : échantillon réduit"
      >
        Peu de parties
      </span>
    </div>
    <div class="space-y-2 border-l-4 pl-3" :class="borderClass[accent]">
      <slot />
    </div>
  </div>
</template>
