<script setup lang="ts">
import type { Grid } from "@hots-stats/shared-types";
import { gridFromWireArrays, sumGrids } from "@hots-stats/shared-types";
import type { MatchSlotHero } from "~/types/spatial";

const props = defineProps<{
  mapId: string;
  gridCols: number;
  gridRows: number;
  heroes: MatchSlotHero[];
}>();

// Everyone selected by default -- "superposition de tous les héros d'une
// partie" per tasks/epic-10-analyse-spatiale.md's Slot model, decocher
// individually from there.
const selected = ref(new Set(props.heroes.map((h) => h.matchPlayerId)));

function toggle(matchPlayerId: string) {
  const next = new Set(selected.value);
  if (next.has(matchPlayerId)) next.delete(matchPlayerId);
  else next.add(matchPlayerId);
  selected.value = next;
}

function selectAllies() {
  selected.value = new Set(props.heroes.filter((h) => h.isAlly).map((h) => h.matchPlayerId));
}

function selectEnemies() {
  selected.value = new Set(props.heroes.filter((h) => !h.isAlly).map((h) => h.matchPlayerId));
}

function selectAll() {
  selected.value = new Set(props.heroes.map((h) => h.matchPlayerId));
}

const activeHeroes = computed(() => props.heroes.filter((h) => selected.value.has(h.matchPlayerId)));
const presenceGrid = computed<Grid>(() =>
  sumGrids(activeHeroes.value.map((h) => gridFromWireArrays(h.presence.cellIndex, h.presence.values))),
);
const killsGrid = computed<Grid>(() =>
  sumGrids(activeHeroes.value.map((h) => gridFromWireArrays(h.kills.cellIndex, h.kills.values))),
);
const deathsGrid = computed<Grid>(() =>
  sumGrids(activeHeroes.value.map((h) => gridFromWireArrays(h.deaths.cellIndex, h.deaths.values))),
);

const showPresence = ref(true);
const showKills = ref(true);
const showDeaths = ref(true);
const presenceOpacity = ref(0.7);
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <span class="mr-1 text-xs font-medium text-muted">Héros :</span>
      <button
        v-for="hero in heroes"
        :key="hero.matchPlayerId"
        type="button"
        class="rounded-full border px-2 py-1 text-xs transition-colors"
        :class="
          selected.has(hero.matchPlayerId)
            ? hero.isAlly
              ? 'border-info bg-info/15 text-info'
              : 'border-danger bg-danger/15 text-danger'
            : 'border-border text-muted hover:text-foreground'
        "
        :aria-pressed="selected.has(hero.matchPlayerId)"
        @click="toggle(hero.matchPlayerId)"
      >
        {{ hero.heroName }}
      </button>
      <span class="mx-1 h-4 w-px bg-border" />
      <UButton size="xs" variant="soft" color="neutral" @click="selectAllies">Mon équipe</UButton>
      <UButton size="xs" variant="soft" color="neutral" @click="selectEnemies">Adversaires</UButton>
      <UButton size="xs" variant="soft" color="neutral" @click="selectAll">Tout</UButton>
    </div>

    <div class="flex flex-wrap items-center gap-4 text-xs text-muted">
      <label class="flex items-center gap-1.5"><input v-model="showPresence" type="checkbox" /> Présence</label>
      <label class="flex items-center gap-1.5"><input v-model="showKills" type="checkbox" /> Kills</label>
      <label class="flex items-center gap-1.5"><input v-model="showDeaths" type="checkbox" /> Morts</label>
      <label class="flex items-center gap-2">
        Opacité présence
        <input v-model.number="presenceOpacity" type="range" min="0.1" max="1" step="0.05" />
      </label>
    </div>

    <SpatialHeatmapView
      :map-id="mapId"
      :grid-cols="gridCols"
      :grid-rows="gridRows"
      :presence-grid="presenceGrid"
      :kills-grid="killsGrid"
      :deaths-grid="deathsGrid"
      :show-presence="showPresence"
      :show-kills="showKills"
      :show-deaths="showDeaths"
      :presence-opacity="presenceOpacity"
    />
  </div>
</template>
