<script setup lang="ts">
import { type DeathMapResponse, deathCellsToGrid } from "@hots-stats/shared-types";

const props = defineProps<{
  mapId: string;
  heroOptions: { id: string; name: string }[];
}>();

const selectedHeroId = ref("");

const heroSelectOptions = computed(() => [{ id: "", name: "Tous les héros" }, ...props.heroOptions]);

const query = computed<Record<string, unknown>>(() => ({
  mapId: props.mapId,
  ...(selectedHeroId.value ? { heroId: selectedHeroId.value } : {}),
}));

// A death map ignores the global game-mode filter (spec section C1 has no
// mode parameter) but stays account-scoped, which useApiFetch injects by
// default.
const { data, pending, error } = useApiFetch<DeathMapResponse>("/spatial/death-map", {
  query,
  withGameMode: false,
});

const deathsGrid = computed(() => (data.value ? deathCellsToGrid(data.value.cells) : {}));
const unknownKillTypes = computed(() => {
  if (!data.value) return 0;
  return data.value.totalDeaths - data.value.killTypeSplit.hero - data.value.killTypeSplit.other;
});
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-1">
      <label class="text-xs text-muted">Héros</label>
      <USelectMenu
        v-model="selectedHeroId"
        value-key="id"
        label-key="name"
        :items="heroSelectOptions"
        size="sm"
        class="w-52"
      />
    </div>

    <UiStateCard v-if="pending && !data" state="loading" size="sm" />
    <UiStateCard v-else-if="error" state="error" size="sm" message="Impossible de charger la carte des morts." />
    <UiStateCard
      v-else-if="!data || data.totalDeaths === 0"
      state="empty"
      size="sm"
      message="Aucune mort enregistrée sur cette carte pour ce filtre."
    />
    <template v-else>
      <p class="text-xs text-muted">
        {{ data.totalDeaths }} mort(s) sur {{ data.matches }} partie(s) · {{ data.positionedDeaths }}
        localisée(s).
      </p>

      <UiStateCard
        v-if="!data.calibrated || data.positionedDeaths === 0 || !data.cells.length"
        state="empty"
        size="sm"
        message="Aucune position exploitable : la carte n'est pas calibrée, ou les morts enregistrées n'ont pas de coordonnées."
      />
      <template v-else>
        <SpatialHeatmapView
          :map-id="mapId"
          :layer="data.layer"
          :grid-cols="data.grid.cols"
          :grid-rows="data.grid.rows"
          :layers="[]"
          :deaths-grid="deathsGrid"
          :show-presence="false"
          :show-kills="false"
          :match-count="data.matches"
        />

        <div v-if="data.clusters.length > 0" class="space-y-1.5">
          <h3 class="font-heading text-xs font-medium">Zones les plus meurtrières</h3>
          <ul class="space-y-1 text-xs text-muted">
            <li v-for="(cluster, i) in data.clusters" :key="cluster.cellIndex" class="flex justify-between gap-2">
              <span>Zone {{ i + 1 }} (cellule {{ cluster.cellIndex }})</span>
              <span>{{ cluster.deaths }} mort(s) · {{ Math.round(cluster.share * 100) }} %</span>
            </li>
          </ul>
        </div>
      </template>

      <div class="flex flex-wrap gap-3 text-[11px] text-muted">
        <span>Mort par un héros : {{ data.killTypeSplit.hero }}</span>
        <span>Autre cause : {{ data.killTypeSplit.other }}</span>
        <span v-if="unknownKillTypes > 0">Cause inconnue : {{ unknownKillTypes }}</span>
      </div>
    </template>
  </div>
</template>
