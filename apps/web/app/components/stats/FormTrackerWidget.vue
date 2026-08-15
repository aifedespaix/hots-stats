<script setup lang="ts">
/**
 * Modular "Suivi de la forme" (momentum) widget: a compact winrate preview
 * over the persisted "last N games" window, plus a button opening
 * `ChartsFormTrackerModal` for the full trend chart and the Volume/Période
 * filter toggle. Dropped as-is onto the hero page (`context: { heroId }`),
 * the map page (`context: { mapId }`), and the matches/history page
 * (`context: {}`, i.e. the whole account) -- the preview always reflects
 * the shared persisted "last N games" value, so it updates in place
 * without a page reload if that value was just changed on another page.
 */
const props = withDefaults(
  defineProps<{
    context: Record<string, string>;
    title?: string;
    modalTitle?: string;
    modalDescription?: string;
  }>(),
  { title: "Forme récente", modalTitle: undefined, modalDescription: undefined },
);

const formTracker = useFormTrackerStore();

const previewQuery = computed(() => ({ ...props.context, limit: formTracker.lastN }));
const { pending, errored, gamesPlayed, wins, winrate, momentum } = useWinrateTrend(previewQuery);

const losses = computed(() => gamesPlayed.value - wins.value);

const momentumLabel: Record<"up" | "down" | "flat", string> = {
  up: "En progression",
  down: "En régression",
  flat: "Stable",
};
const momentumIcon: Record<"up" | "down" | "flat", string> = {
  up: "i-heroicons-arrow-trending-up",
  down: "i-heroicons-arrow-trending-down",
  flat: "i-heroicons-minus-small",
};
const momentumClass: Record<"up" | "down" | "flat", string> = {
  up: "text-success",
  down: "text-danger",
  flat: "text-muted",
};

const open = ref(false);
</script>

<template>
  <div class="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
    <div class="min-w-0">
      <p class="text-xs uppercase tracking-wide text-muted">{{ title }}</p>

      <p v-if="pending" class="mt-1 text-sm text-muted">Chargement…</p>
      <p v-else-if="errored" class="mt-1 text-sm text-danger">Indisponible.</p>
      <p v-else-if="gamesPlayed === 0" class="mt-1 text-sm text-muted">Aucune partie enregistrée.</p>
      <div v-else class="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span class="font-mono text-lg font-semibold sm:text-xl" :class="(winrate ?? 0) >= 0.5 ? 'text-success' : 'text-danger'">
          {{ formatPercent(winrate ?? 0) }}
        </span>
        <span class="text-xs text-muted">{{ wins }}V - {{ losses }}D sur {{ gamesPlayed }} parties</span>
        <span v-if="momentum" class="flex items-center gap-0.5 text-xs font-medium" :class="momentumClass[momentum]">
          <UIcon :name="momentumIcon[momentum]" class="h-3.5 w-3.5" />
          {{ momentumLabel[momentum] }}
        </span>
      </div>
    </div>

    <UTooltip text="Analyser la tendance" :popper="{ placement: 'top' }">
      <button
        type="button"
        aria-label="Analyser la tendance du winrate"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-all duration-150 hover:scale-110 hover:bg-brand/15 hover:text-brand active:scale-95"
        @click="open = true"
      >
        <UIcon name="i-heroicons-plus" class="h-4 w-4" />
      </button>
    </UTooltip>

    <ChartsFormTrackerModal
      v-model:open="open"
      :context="context"
      :title="modalTitle ?? title"
      :description="modalDescription"
    />
  </div>
</template>
