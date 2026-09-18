<script setup lang="ts">
import { PROGRESSION_MIN_MATCHES, type DriverMetric } from "@hots-stats/shared-types";
import { selectWorkAxes } from "~/composables/useProgression";

const props = withDefaults(
  defineProps<{
    drivers?: DriverMetric[];
    matches?: number;
    insufficientSample?: boolean;
    loading?: boolean;
    error?: boolean;
  }>(),
  { drivers: () => [], matches: 0, insufficientSample: true, loading: false, error: false },
);

const axes = computed(() => selectWorkAxes(props.drivers));

/** One actionable imperative per driver key; fallback covers any future metric. */
const DRILLS: Record<string, string> = {
  earlyDeaths: "Concentre-toi sur les 5 premières minutes : une mort précoce offre le premier objectif à l'adversaire.",
  deathsPer10Min: "Réduis le nombre de morts par tranche de 10 minutes : chaque mort coûte du temps de jeu.",
  firstDeath: "Évite la toute première mort de la partie : elle ouvre souvent le premier objectif.",
  outnumberedDeaths: "Vérifie le compteur d'équipe avant d'engager : les morts en sous-nombre se paient cher.",
  xpPerMinute: "Reste sur la ligne de front pour capter l'XP : les vagues manquées se rattrapent mal.",
  heroDamagePerMinute: "Augmente ton temps de contact utile : les dégâts par minute suivent le temps passé à portée.",
  killParticipation: "Rejoins les combats d'équipe plus tôt : ta participation monte avec ta présence.",
  timeDeadShare: "Estimation basée sur un temps de réapparition fixe — priorise la survie.",
  avgHeroLevelAt10Min: "Vise un niveau plus haut à 10 minutes : soigne ton clear de vagues et tes rotations.",
};

function drillFor(key: string): string {
  return DRILLS[key] ?? "Regarde ce chiffre de plus près : c'est lui qui sépare le plus tes victoires de tes défaites.";
}

function formatMetric(key: string, value: number): string {
  if (key === "timeDeadShare" || key === "firstDeath") return formatPercent(value);
  return value.toFixed(2);
}
</script>

<template>
  <UiPanel title="Tes 3 axes de travail" :count="axes.length">
    <UiStateCard v-if="loading" state="loading" size="sm" />
    <UiStateCard v-else-if="error" state="error" size="sm" message="Impossible de charger les axes de travail." />
    <UiStateCard
      v-else-if="insufficientSample || axes.length === 0"
      state="empty"
      size="sm"
      :message="
        matches === 0
          ? 'Aucune partie analysée pour cette période.'
          : 'Seulement ' +
            matches +
            ' partie(s) analysée(s) — au moins ' +
            PROGRESSION_MIN_MATCHES +
            ' sont nécessaires pour dégager un axe fiable.'
      "
    />
    <div v-else class="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <article
        v-for="axis in axes"
        :key="axis.key"
        class="flex flex-col gap-3 rounded-lg border border-border bg-background p-3 sm:p-4"
      >
        <div>
          <p class="font-heading text-sm font-semibold">{{ axis.label }}</p>
          <p class="mt-0.5 text-xs text-muted">
            {{ axis.betterWhen === "lower" ? "Plus bas = mieux" : "Plus haut = mieux" }}
          </p>
        </div>

        <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt class="text-muted">En victoire</dt>
          <dd class="text-right font-mono">{{ formatMetric(axis.key, axis.meanInWins) }}</dd>
          <dt class="text-muted">En défaite</dt>
          <dd class="text-right font-mono">{{ formatMetric(axis.key, axis.meanInLosses) }}</dd>
        </dl>

        <p class="text-xs text-muted">
          n = {{ axis.winsSample }} victoire(s) / {{ axis.lossesSample }} défaite(s)
        </p>

        <p class="text-sm">{{ drillFor(axis.key) }}</p>

        <UiArrowLink to="/matches" class="mt-auto">Voir mes parties</UiArrowLink>
      </article>
    </div>
  </UiPanel>
</template>
