<script setup lang="ts">
withDefaults(
  defineProps<{
    to: string;
    icon: string;
    /** Petit libellé en majuscules au-dessus de la ligne titre (slot par défaut). */
    eyebrow: string;
    tone?: "brand" | "success" | "danger";
  }>(),
  { tone: "brand" },
);

const toneClass: Record<"brand" | "success" | "danger", string> = {
  brand: "border-brand/30 bg-brand/5 hover:bg-brand/10 text-brand",
  success: "border-success/30 bg-success/5 hover:bg-success/10 text-success",
  danger: "border-danger/30 bg-danger/5 hover:bg-danger/10 text-danger",
};
</script>

<template>
  <NuxtLink
    :to="to"
    class="flex items-center gap-3 rounded-lg border p-4 transition-colors"
    :class="toneClass[tone]"
  >
    <UIcon :name="icon" class="h-5 w-5 shrink-0" />
    <div class="min-w-0 flex-1">
      <p class="text-xs uppercase tracking-wide text-muted">{{ eyebrow }}</p>
      <p class="truncate text-sm font-medium text-foreground"><slot /></p>
    </div>
    <UIcon name="i-heroicons-chevron-right" class="h-4 w-4 shrink-0 text-muted" />
  </NuxtLink>
</template>
