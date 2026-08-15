<script setup lang="ts">
import type { HeroStatsScope } from "@hots-stats/shared-types";

const props = withDefaults(
  defineProps<{
    modelValue: HeroStatsScope;
    loading?: boolean;
    personalLabel?: string;
    personalDescription?: string;
  }>(),
  {
    loading: false,
    personalLabel: "Mes parties",
    personalDescription: "Uniquement les parties du joueur connecté",
  },
);

const emit = defineEmits<{ (e: "update:modelValue", value: HeroStatsScope): void }>();

const isGlobal = computed({
  get: () => props.modelValue === "global",
  set: (value: boolean) => emit("update:modelValue", value ? "global" : "personal"),
});
</script>

<template>
  <div class="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center">
    <div class="flex-1">
      <p class="text-sm font-medium">Portée des statistiques</p>
      <p class="text-xs text-muted">
        {{ isGlobal ? "Toutes les parties enregistrées par l'application" : personalDescription }}
      </p>
    </div>
    <div class="flex items-center gap-2 text-xs">
      <span :class="!isGlobal ? 'font-medium text-foreground' : 'text-muted'">{{ personalLabel }}</span>
      <UToggle v-model="isGlobal" :loading="loading" />
      <span :class="isGlobal ? 'font-medium text-foreground' : 'text-muted'">Toute l'app</span>
    </div>
  </div>
</template>
