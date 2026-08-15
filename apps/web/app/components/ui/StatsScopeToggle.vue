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

const isGlobal = computed(() => props.modelValue === "global");

function select(value: HeroStatsScope) {
  if (props.loading || value === props.modelValue) return;
  emit("update:modelValue", value);
}
</script>

<template>
  <div class="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center">
    <div class="flex-1">
      <p class="text-sm font-medium">Portée des statistiques</p>
      <p class="text-xs text-muted">
        {{ isGlobal ? "Toutes les parties enregistrées par l'application" : personalDescription }}
      </p>
    </div>

    <div
      class="flex shrink-0 items-center gap-1 rounded-full border border-border bg-elevated p-1"
      role="group"
      aria-label="Portée des statistiques"
    >
      <button
        type="button"
        :disabled="loading"
        :aria-pressed="!isGlobal"
        class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        :class="!isGlobal ? 'bg-primary text-inverted' : 'text-muted hover:text-foreground'"
        @click="select('personal')"
      >
        <UIcon name="i-heroicons-user" class="h-3.5 w-3.5" />
        {{ personalLabel }}
      </button>
      <button
        type="button"
        :disabled="loading"
        :aria-pressed="isGlobal"
        class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        :class="isGlobal ? 'bg-primary text-inverted' : 'text-muted hover:text-foreground'"
        @click="select('global')"
      >
        <UIcon name="i-heroicons-globe-alt" class="h-3.5 w-3.5" />
        Toute l'app
      </button>
      <UIcon v-if="loading" name="i-heroicons-arrow-path" class="ml-1 h-3.5 w-3.5 shrink-0 animate-spin text-muted" />
    </div>
  </div>
</template>
