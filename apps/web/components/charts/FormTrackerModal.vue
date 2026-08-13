<script setup lang="ts">
/**
 * "Suivi de la forme" detail modal: winrate trend chart over either the last
 * N games ("Volume") or a custom date range ("Période"), scoped to whatever
 * `context` filters the host page passes in (a hero, a map, or nothing for
 * the whole account). Reuses the same cumulative-winrate chart as the
 * matches page's own trend modal (`useWinrateTrendChart`) so both look
 * identical.
 */
const props = defineProps<{
  open: boolean;
  context: Record<string, string>;
  title?: string;
  description?: string;
}>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const formTracker = useFormTrackerStore();

type Mode = "volume" | "period";
const mode = ref<Mode>("volume");

const lastNInput = ref(String(formTracker.lastN));
watch(
  () => formTracker.lastN,
  (value) => {
    lastNInput.value = String(value);
  },
);
function commitLastN() {
  const parsed = Number.parseInt(lastNInput.value, 10);
  if (Number.isFinite(parsed) && parsed >= 1) {
    formTracker.setLastN(parsed);
  }
  lastNInput.value = String(formTracker.lastN);
}

const dateFrom = ref("");
const dateTo = ref("");

const isOpen = computed(() => props.open);

const query = computed<Record<string, unknown>>(() => {
  if (mode.value === "period") {
    return {
      ...props.context,
      ...(dateFrom.value ? { dateFrom: new Date(dateFrom.value).toISOString() } : {}),
      ...(dateTo.value ? { dateTo: new Date(`${dateTo.value}T23:59:59`).toISOString() } : {}),
    };
  }
  return { ...props.context, limit: formTracker.lastN };
});

const { points, pending, errored, gamesPlayed, wins, winrate } = useWinrateTrend(query, isOpen);
const { chartData, chartOptions } = useWinrateTrendChart(points);

const losses = computed(() => gamesPlayed.value - wins.value);
</script>

<template>
  <UModal :model-value="open" @update:model-value="(value) => emit('update:open', value as boolean)">
    <div class="p-6">
      <h2 class="font-heading text-lg font-semibold">{{ title ?? "Suivi de la forme" }}</h2>
      <p v-if="description" class="mt-1 text-sm text-muted">{{ description }}</p>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-1 rounded-full border border-border bg-surface p-1">
          <button
            type="button"
            class="rounded-full px-3 py-1 text-xs font-medium transition-colors"
            :class="mode === 'volume' ? 'bg-brand text-white' : 'text-muted hover:text-foreground'"
            @click="mode = 'volume'"
          >
            Volume
          </button>
          <button
            type="button"
            class="rounded-full px-3 py-1 text-xs font-medium transition-colors"
            :class="mode === 'period' ? 'bg-brand text-white' : 'text-muted hover:text-foreground'"
            @click="mode = 'period'"
          >
            Période
          </button>
        </div>

        <div v-if="mode === 'volume'" class="flex items-center gap-2 text-sm">
          <span class="text-muted">Les</span>
          <UInput
            v-model="lastNInput"
            type="number"
            min="1"
            max="500"
            class="w-20"
            @change="commitLastN"
            @blur="commitLastN"
          />
          <span class="text-muted">dernières parties</span>
        </div>
        <div v-else class="flex flex-wrap items-center gap-2 text-sm">
          <UInput v-model="dateFrom" type="date" placeholder="Du" />
          <span class="text-muted">au</span>
          <UInput v-model="dateTo" type="date" placeholder="Au" />
        </div>
      </div>

      <div class="mt-4 grid grid-cols-3 gap-3">
        <UiStatTile
          label="Winrate"
          :value="winrate === null ? '-' : formatPercent(winrate)"
          :tone="winrate === null ? 'default' : winrate >= 0.5 ? 'success' : 'danger'"
        />
        <UiStatTile label="Victoires" :value="String(wins)" />
        <UiStatTile label="Défaites" :value="String(losses)" />
      </div>

      <div class="mt-4 h-72">
        <p v-if="pending" class="flex h-full items-center justify-center text-sm text-muted">Chargement…</p>
        <p v-else-if="errored" class="flex h-full items-center justify-center text-sm text-danger">
          Impossible de charger le graphique.
        </p>
        <p v-else-if="gamesPlayed === 0" class="flex h-full items-center justify-center text-sm text-muted">
          Aucune partie pour cette fenêtre.
        </p>
        <ChartsLineChart v-else :data="chartData" :options="chartOptions" />
      </div>
    </div>
  </UModal>
</template>
