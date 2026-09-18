<script setup lang="ts">
import { PROGRESSION_MIN_MATCHES, type PatternAggregate } from "@hots-stats/shared-types";

const props = withDefaults(
  defineProps<{ aggregate?: PatternAggregate | null; loading?: boolean; error?: boolean }>(),
  { aggregate: null, loading: false, error: false },
);

const columns = [
  { key: "label", label: "Pattern" },
  { key: "value", label: "Valeur", numeric: true },
  { key: "base", label: "n", numeric: true },
];

const rows = computed(() => {
  const aggregate = props.aggregate;
  if (!aggregate) return [];
  return [
    { key: "firstDeath", label: "Première mort de la partie", value: formatPercent(aggregate.firstDeathRate), base: aggregate.matches },
    { key: "earlyDeath", label: "Morts avant 5 min", value: formatPercent(aggregate.earlyDeathRate), base: aggregate.matches },
    {
      key: "outnumbered",
      label: "Morts en sous-nombre",
      value: formatPercent(aggregate.outnumberedDeathRate) + " (" + aggregate.outnumberedDeaths + ")",
      base: aggregate.matches,
    },
    {
      key: "staggered",
      label: "Morts en décalage",
      value: formatPercent(aggregate.staggeredDeathRate) + " (" + aggregate.staggeredDeaths + ")",
      base: aggregate.matches,
    },
    {
      key: "talentDelay",
      label: "Retard de palier",
      value: formatPercent(aggregate.talentDelayRate) + " (" + aggregate.talentDelayFights + ")",
      base: aggregate.matches,
    },
    { key: "timeDeadShare", label: "Part du temps mort (estimation)", value: formatPercent(aggregate.timeDeadShare), base: aggregate.matches },
    { key: "deathsPer10Min", label: "Morts / 10 min", value: aggregate.deathsPer10Min.toFixed(2), base: aggregate.matches },
  ];
});

const isEmpty = computed(() => !props.loading && !props.error && (props.aggregate?.matches ?? 0) === 0);
</script>

<template>
  <UiPanel title="Tes patterns récurrents" :count="aggregate?.matches ?? 0">
    <UiStateCard v-if="loading" state="loading" size="sm" />
    <UiStateCard v-else-if="error" state="error" size="sm" message="Impossible de charger tes patterns." />
    <UiStateCard
      v-else-if="isEmpty"
      state="empty"
      size="sm"
      message="Aucune partie avec journal de morts pour cette période."
    />
    <div v-else class="space-y-3">
      <p
        v-if="aggregate?.insufficientSample"
        class="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted"
      >
        Seulement {{ aggregate.matches }} partie(s) — seuil de
        {{ PROGRESSION_MIN_MATCHES }} pour lire ces taux comme une tendance. Les comptes restent affichés.
      </p>

      <UiDataTable
        :columns="columns"
        :rows="rows"
        row-key="key"
        mobile-primary-key="label"
        mobile-badge-key="value"
      />

      <p v-if="aggregate" class="text-xs text-muted">
        Sources exploitées : journal de morts {{ aggregate.coverage.withTimeline }}/{{ aggregate.matches }} · niveaux
        {{ aggregate.coverage.withLevelSnapshots }}/{{ aggregate.matches }} · positions
        {{ aggregate.coverage.withPositions }}/{{ aggregate.matches }}
      </p>
    </div>
  </UiPanel>
</template>
