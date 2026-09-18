<script setup lang="ts">
import { PROGRESSION_MIN_MATCHES, type TrendPoint } from "@hots-stats/shared-types";

const props = withDefaults(
  defineProps<{ points?: TrendPoint[] | null; loading?: boolean; error?: boolean }>(),
  { points: null, loading: false, error: false },
);

const summary = computed(() => summarizeLastSession(props.points ?? []));
const isEmpty = computed(() => !props.loading && !props.error && !summary.value);
const recordTone = computed(() =>
  summary.value?.insufficientSample ? "default" : winrateTone(summary.value?.winrate),
);
</script>

<template>
  <UiPanel title="Dernière session" :count="summary?.gamesPlayed">
    <UiStateCard v-if="loading" state="loading" size="sm" />
    <UiStateCard
      v-else-if="error"
      state="error"
      size="sm"
      message="Impossible de charger ta dernière session."
    />
    <UiStateCard
      v-else-if="isEmpty"
      state="empty"
      size="sm"
      message="Aucune partie enregistrée pour l'instant."
    />
    <div v-else-if="summary" class="space-y-2">
      <div class="flex items-baseline gap-3">
        <span class="font-mono text-lg font-semibold" :class="TONE_TEXT_CLASS[recordTone]">
          {{ summary.wins }} V · {{ summary.losses }} D
        </span>
        <span class="text-sm text-muted">
          {{ summary.gamesPlayed }} partie{{ summary.gamesPlayed > 1 ? "s" : "" }}
        </span>
      </div>
      <p class="text-sm text-muted">{{ formatDate(summary.startedAt) }}</p>
      <p class="text-sm">
        Session terminée sur une {{ summary.lastResult === "win" ? "victoire" : "défaite" }}.
      </p>
      <p v-if="summary.insufficientSample" class="text-xs text-muted">
        Échantillon de {{ summary.gamesPlayed }} partie{{ summary.gamesPlayed > 1 ? "s" : "" }} — au
        moins {{ PROGRESSION_MIN_MATCHES }} sont nécessaires pour conclure.
      </p>
    </div>
  </UiPanel>
</template>
