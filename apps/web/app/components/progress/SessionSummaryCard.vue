<script setup lang="ts">
import type { SessionRecapResponse } from "@hots-stats/shared-types";

const props = withDefaults(
  defineProps<{ recap?: SessionRecapResponse | null; loading?: boolean; error?: boolean }>(),
  { recap: null, loading: false, error: false },
);

const session = computed(() => props.recap?.session ?? null);
const stats = computed(() => session.value?.stats ?? null);
const lastResult = computed(() =>
  session.value ? session.value.matches[session.value.matches.length - 1]?.winner : undefined,
);
const record = computed(() =>
  stats.value ? stats.value.wins + " V · " + stats.value.losses + " D" : "—",
);
const isEmpty = computed(() => !props.loading && !props.error && !session.value);
const recordTone = computed(() =>
  props.recap?.insufficientSample ? "default" : winrateTone(stats.value?.winrate),
);
</script>

<template>
  <UiPanel title="Dernière session" :count="stats?.gamesPlayed">
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
    <div v-else-if="session && stats" class="space-y-2">
      <div class="flex items-baseline gap-3">
        <span class="font-mono text-lg font-semibold" :class="TONE_TEXT_CLASS[recordTone]">
          {{ record }}
        </span>
        <span class="text-sm text-muted">
          {{ stats.gamesPlayed }} partie{{ stats.gamesPlayed > 1 ? "s" : "" }}
        </span>
      </div>
      <p class="text-sm text-muted">{{ formatDate(session.startedAt) }}</p>
      <p class="text-sm">
        Session terminée sur une {{ lastResult ? "victoire" : "défaite" }}.
      </p>
      <p v-if="recap?.insufficientSample" class="text-xs text-muted">
        Échantillon de {{ stats.gamesPlayed }} partie{{ stats.gamesPlayed > 1 ? "s" : "" }} — le
        récap affiche les écarts avec leur marge de bruit, pas comme un verdict.
      </p>
      <UiArrowLink to="/session" class="text-xs">Voir le récap complet</UiArrowLink>
    </div>
  </UiPanel>
</template>
