<script setup lang="ts">
import type { ContextBreakdown, ContextBucket, ContextResponse } from "@hots-stats/shared-types";

const props = withDefaults(
  defineProps<{
    context?: ContextResponse | null;
    loading?: boolean;
    error?: boolean;
    /** Forwarded to `UiPanel`: false lets the panel grow with the page instead of scrolling on its own. */
    scrollable?: boolean;
  }>(),
  { context: null, loading: false, error: false, scrollable: true },
);

const themeColor = useChartThemeColor();

function findBreakdown(dimension: string): ContextBreakdown | undefined {
  return props.context?.breakdowns.find((entry) => entry.dimension === dimension);
}

function makeBarChart(breakdown: ContextBreakdown | undefined) {
  const buckets = breakdown?.buckets ?? [];
  return {
    data: {
      labels: buckets.map((bucket) => bucket.label),
      datasets: [
        {
          label: "Winrate",
          data: buckets.map((bucket) => Math.round(bucket.winrate * 1000) / 10),
          backgroundColor: buckets.map((bucket) =>
            bucket.insufficientSample ? themeColor("--raw-muted", 0.4) : themeColor("--raw-primary"),
          ),
          borderRadius: 4,
        },
      ],
    },
    options: {
      scales: {
        x: { grid: { display: false }, ticks: { color: themeColor("--raw-muted"), maxRotation: 0, autoSkip: true } },
        y: {
          min: 0,
          max: 100,
          grid: { color: themeColor("--raw-border") },
          ticks: { color: themeColor("--raw-muted"), callback: (value: number | string) => value + "%" },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: { dataIndex: number }) => {
              const bucket = buckets[ctx.dataIndex];
              if (!bucket) return "";
              return bucket.gamesPlayed + " partie(s) · " + formatPercent(bucket.winrate);
            },
          },
        },
      },
    },
  };
}

const hourChart = computed(() => makeBarChart(findBreakdown("hour")));
const weekdayChart = computed(() => makeBarChart(findBreakdown("weekday")));
const sessionSizeChart = computed(() => makeBarChart(findBreakdown("sessionSize")));

const contextColumns = [
  { key: "label", label: "Contexte" },
  { key: "gamesPlayed", label: "Parties", numeric: true },
  { key: "winrate", label: "Winrate", numeric: true },
];

function tableRows(dimension: string) {
  return (findBreakdown(dimension)?.buckets ?? []).map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    gamesPlayed: bucket.gamesPlayed,
    winrate: formatPercent(bucket.winrate),
  }));
}

const sessionPositionRows = computed(() => tableRows("sessionPosition"));
const patchRows = computed(() => tableRows("patch"));
const compositionRows = computed(() => tableRows("teamComposition"));

/** Best-played bucket with at least one game, for the chart's text summary. */
function bestBucket(breakdown: ContextBreakdown | undefined): ContextBucket | null {
  let best: ContextBucket | null = null;
  for (const bucket of breakdown?.buckets ?? []) {
    if (bucket.gamesPlayed === 0) continue;
    if (!best || bucket.winrate > best.winrate) best = bucket;
  }
  return best;
}

function summarize(breakdown: ContextBreakdown | undefined): string {
  const best = bestBucket(breakdown);
  if (!best || !breakdown) return "Pas encore de données sur cette dimension.";
  return (
    breakdown.label + " — meilleur créneau : " + best.label + " (" + formatPercent(best.winrate) + " sur " +
    best.gamesPlayed + " partie(s))."
  );
}

const isEmpty = computed(() => !props.loading && !props.error && (props.context?.matches ?? 0) === 0);
</script>

<template>
  <UiPanel title="Ton contexte" :count="context?.matches ?? 0" :scrollable="scrollable">
    <UiStateCard v-if="loading" state="loading" size="sm" />
    <UiStateCard v-else-if="error" state="error" size="sm" message="Impossible de charger ton contexte." />
    <UiStateCard
      v-else-if="isEmpty"
      state="empty"
      size="sm"
      message="Aucune partie pour cette période — le contexte apparaîtra après quelques games."
    />
    <div v-else class="space-y-5">
      <section class="min-w-0">
        <h3 class="mb-2 font-heading text-sm font-medium">Heure de la journée</h3>
        <div class="h-56 w-full min-w-0">
          <ChartsBarChart :data="hourChart.data" :options="hourChart.options" />
        </div>
        <p class="mt-2 text-sm text-muted">{{ summarize(findBreakdown("hour")) }}</p>
      </section>

      <section class="min-w-0">
        <h3 class="mb-2 font-heading text-sm font-medium">Jour de la semaine</h3>
        <div class="h-56 w-full min-w-0">
          <ChartsBarChart :data="weekdayChart.data" :options="weekdayChart.options" />
        </div>
        <p class="mt-2 text-sm text-muted">{{ summarize(findBreakdown("weekday")) }}</p>
      </section>

      <section class="min-w-0">
        <h3 class="mb-2 font-heading text-sm font-medium">Taille de session</h3>
        <div class="h-56 w-full min-w-0">
          <ChartsBarChart :data="sessionSizeChart.data" :options="sessionSizeChart.options" />
        </div>
        <p class="mt-2 text-sm text-muted">{{ summarize(findBreakdown("sessionSize")) }}</p>
      </section>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section class="min-w-0">
          <h3 class="mb-2 font-heading text-sm font-medium">Rang dans la session</h3>
          <UiDataTable
            :columns="contextColumns"
            :rows="sessionPositionRows"
            row-key="key"
            mobile-primary-key="label"
            mobile-badge-key="winrate"
          />
        </section>

        <section class="min-w-0">
          <h3 class="mb-2 font-heading text-sm font-medium">Patch</h3>
          <UiDataTable
            :columns="contextColumns"
            :rows="patchRows"
            row-key="key"
            mobile-primary-key="label"
            mobile-badge-key="winrate"
          />
        </section>
      </div>

      <section class="min-w-0">
        <h3 class="mb-2 font-heading text-sm font-medium">Composition d'équipe</h3>
        <UiDataTable
          :columns="contextColumns"
          :rows="compositionRows"
          row-key="key"
          mobile-primary-key="label"
          mobile-badge-key="winrate"
        />
      </section>
    </div>
  </UiPanel>
</template>
