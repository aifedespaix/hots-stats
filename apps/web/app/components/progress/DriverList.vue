<script setup lang="ts">
import { PROGRESSION_MIN_PER_SIDE, type DriverMetric } from "@hots-stats/shared-types";
import { buildDriverRows } from "~/utils/driverDisplay";
import { TONE_TEXT_CLASS, type Tone } from "~/utils/tone";

const props = withDefaults(
  defineProps<{
    drivers?: DriverMetric[];
    matches?: number;
    loading?: boolean;
    error?: boolean;
  }>(),
  { drivers: () => [], matches: 0, loading: false, error: false },
);

/** Columns match the A4 method: conditional means, Cohen's d, and both n. */
const columns = [
  { key: "label", label: "Métrique" },
  { key: "valueInWins", label: "En victoire", numeric: true },
  { key: "valueInLosses", label: "En défaite", numeric: true },
  { key: "effect", label: "Effet (d)", numeric: true },
  { key: "sample", label: "n (V / D)", numeric: true },
];

const rows = computed(() => buildDriverRows(props.drivers));
const isEmpty = computed(() => !props.loading && !props.error && rows.value.length === 0);
const hasReliable = computed(() => rows.value.some((row) => row.reliable));
</script>

<template>
  <UiPanel title="Ce qui sépare tes victoires de tes défaites" :count="matches">
    <UiStateCard v-if="loading" state="loading" size="sm" />
    <UiStateCard
      v-else-if="error"
      state="error"
      size="sm"
      message="Impossible de charger les facteurs de victoire."
    />
    <UiStateCard
      v-else-if="isEmpty"
      state="empty"
      size="sm"
      message="Aucune métrique exploitable pour cette période."
    />
    <div v-else class="space-y-3">
      <p
        v-if="!hasReliable"
        class="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted"
      >
        Moins de {{ PROGRESSION_MIN_PER_SIDE }} parties d'un côté ou de l'autre : les chiffres restent
        affichés, mais aucun écart n'est concluant.
      </p>

      <UiDataTable
        :columns="columns"
        :rows="rows"
        row-key="key"
        mobile-primary-key="label"
        mobile-badge-key="sample"
      >
        <template #cell-effect="{ row }">
          <span :class="TONE_TEXT_CLASS[row.tone as Tone]">{{ row.effect }}</span>
        </template>
      </UiDataTable>

      <p class="text-xs text-muted">
        d de Cohen : écart des moyennes victoires/défaites divisé par l'écart-type regroupé. Un effet
        fiable demande au moins {{ PROGRESSION_MIN_PER_SIDE }} parties de chaque côté.
      </p>
    </div>
  </UiPanel>
</template>
