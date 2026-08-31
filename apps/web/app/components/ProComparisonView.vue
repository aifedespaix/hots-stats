<script setup lang="ts">
import { GAME_A_PALETTE, GAME_B_PALETTE, splitDeltaGrid } from "~/utils/heatmapRenderer";
import type { HeatmapEventType, HeatmapGameData, HeatmapPhase, HeatmapWindowMode } from "~/composables/useHeatmapSync";
import type { MatchDetailResponse } from "~/types/matches";
import type { HeatmapMarker } from "~/utils/heatmapRenderer";

/**
 * The "Comparateur de Heatmaps Avancé": two matches, side-by-side, driven by
 * a single shared timeline + viewport. Each match's own hero trajectories
 * (per-sample timestamped positions, see `spatial.trajectories` on
 * `GET /matches/:id`) power time-sliced/event-anchored density heatmaps and
 * literal rotation pathing -- the match-long `spatial.presence` grid the
 * rest of the app's heatmaps use has no timestamp left for either of those.
 *
 * Note: `matchIdA`/`matchIdB` are fetched once on mount, not reactively --
 * swap comparisons by remounting this component (e.g. a parent `:key`
 * bound to both ids), same one-shot-fetch convention `pages/matches/[id].vue`
 * already uses for a single match.
 */
const props = defineProps<{ matchIdA: string; matchIdB: string }>();

const {
  data: responseA,
  pending: pendingA,
  error: errorA,
} = await useApiFetch<MatchDetailResponse>(`/matches/${props.matchIdA}`, { withGameMode: false });
const {
  data: responseB,
  pending: pendingB,
  error: errorB,
} = await useApiFetch<MatchDetailResponse>(`/matches/${props.matchIdB}`, { withGameMode: false });

const { data: authData } = useAuthUser();
const myBattletag = computed(() => authData.value?.user?.battletag ?? null);

function toHeatmapGameData(response: MatchDetailResponse | null | undefined): HeatmapGameData | null {
  if (!response) return null;
  return {
    mapId: response.match.mapId,
    durationSeconds: response.match.durationSeconds,
    trajectories: response.spatial?.trajectories ?? [],
    levelSnapshots: response.timeline?.levelSnapshots ?? [],
    deaths: response.timeline?.deaths ?? [],
    structureEvents: response.timeline?.structureEvents ?? [],
  };
}

const gameA = computed(() => toHeatmapGameData(responseA.value));
const gameB = computed(() => toHeatmapGameData(responseB.value));

const heatmap = useHeatmapSync(gameA, gameB);

interface HeroOption {
  battletag: string;
  heroId: string;
  heroName: string;
  team: number;
}

function heroOptionsFor(response: MatchDetailResponse | null | undefined): HeroOption[] {
  if (!response) return [];
  const trajectoryBattletags = new Set(
    (response.spatial?.trajectories ?? []).map((t) => t.battletag).filter((b): b is string => b !== null),
  );
  return response.teams
    .flatMap((t) => t.players)
    .filter((p) => trajectoryBattletags.has(p.battletag))
    .map((p) => ({ battletag: p.battletag, heroId: p.heroId, heroName: p.heroName, team: p.team }));
}

const heroOptionsA = computed(() => heroOptionsFor(responseA.value));
const heroOptionsB = computed(() => heroOptionsFor(responseB.value));

// Defaults to "me" for game A when this account played in it, otherwise the
// first available hero -- matches the spec's "Game A (Moi) / Game B (Pro)"
// framing without hard-requiring it.
watch(
  heroOptionsA,
  (options) => {
    if (heatmap.selectedBattletagA.value || options.length === 0) return;
    heatmap.selectedBattletagA.value = options.find((o) => o.battletag === myBattletag.value)?.battletag ?? options[0]!.battletag;
  },
  { immediate: true },
);
watch(
  heroOptionsB,
  (options) => {
    if (heatmap.selectedBattletagB.value || options.length === 0) return;
    heatmap.selectedBattletagB.value = options[0]!.battletag;
  },
  { immediate: true },
);

function deathMarkersFor(game: HeatmapGameData | null, currentSeconds: number): HeatmapMarker[] {
  if (!game) return [];
  return game.deaths
    .filter((d) => d.atSeconds <= currentSeconds && d.x !== undefined && d.y !== undefined && (d.layer ?? null) === null)
    .map((d) => ({ x: d.x as number, y: d.y as number }));
}

const deathMarkersA = computed(() => deathMarkersFor(gameA.value, heatmap.currentSecondsA.value));
const deathMarkersB = computed(() => deathMarkersFor(gameB.value, heatmap.currentSecondsB.value));

const sameMap = computed(() => gameA.value !== null && gameB.value !== null && gameA.value.mapId === gameB.value.mapId);
watch(sameMap, (same) => {
  if (!same) heatmap.deltaMode.value = false;
});

const deltaSplit = computed(() => splitDeltaGrid(heatmap.deltaGrid.value));

const PHASES: { value: HeatmapPhase; label: string }[] = [
  { value: "early", label: "Early (1-9)" },
  { value: "mid", label: "Mid (10-15)" },
  { value: "late", label: "Late (16-20+)" },
];
const EVENT_TYPES: { value: HeatmapEventType; label: string }[] = [
  { value: "death", label: "Mort" },
  { value: "structure", label: "Structure détruite" },
  { value: "objective", label: "Spawn d'objectif" },
];
const WINDOW_MODES: { value: HeatmapWindowMode; label: string }[] = [
  { value: "cumulative", label: "Partie entière" },
  { value: "phase", label: "Par phase" },
  { value: "event", label: "Autour d'un événement" },
];
</script>

<template>
  <div class="space-y-4">
    <div v-if="pendingA || pendingB" class="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
      Chargement des deux parties…
    </div>
    <div v-else-if="errorA || errorB" class="rounded-lg border border-danger/30 bg-danger/10 p-6 text-center text-sm text-danger">
      Impossible de charger l'une des deux parties.
    </div>

    <template v-else-if="gameA && gameB">
      <div class="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-3">
        <div class="flex items-center gap-2 text-xs">
          <span class="text-muted">Slider :</span>
          <UButton
            size="xs"
            :variant="heatmap.syncMode.value === 'progress' ? 'solid' : 'soft'"
            color="neutral"
            @click="heatmap.syncMode.value = 'progress'"
          >
            % de progression
          </UButton>
          <UButton
            size="xs"
            :variant="heatmap.syncMode.value === 'gameTime' ? 'solid' : 'soft'"
            color="neutral"
            @click="heatmap.syncMode.value = 'gameTime'"
          >
            Temps de jeu partagé
          </UButton>
        </div>

        <div class="flex flex-1 items-center gap-2">
          <input v-model.number="heatmap.sliderPercent.value" type="range" min="0" max="100" step="1" class="flex-1" />
          <span class="w-28 shrink-0 font-mono text-xs text-muted">
            {{ Math.round(heatmap.currentSecondsA.value) }}s / {{ Math.round(heatmap.currentSecondsB.value) }}s
          </span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-3 text-xs">
        <div class="flex items-center gap-1.5">
          <span class="text-muted">Fenêtre :</span>
          <UButton
            v-for="mode in WINDOW_MODES"
            :key="mode.value"
            size="xs"
            :variant="heatmap.windowMode.value === mode.value ? 'solid' : 'soft'"
            color="neutral"
            @click="heatmap.windowMode.value = mode.value"
          >
            {{ mode.label }}
          </UButton>
        </div>

        <div v-if="heatmap.windowMode.value === 'phase'" class="flex items-center gap-1.5">
          <UButton
            v-for="phase in PHASES"
            :key="phase.value"
            size="xs"
            :variant="heatmap.selectedPhase.value === phase.value ? 'solid' : 'soft'"
            color="neutral"
            @click="heatmap.selectedPhase.value = phase.value"
          >
            {{ phase.label }}
          </UButton>
        </div>

        <div v-if="heatmap.windowMode.value === 'event'" class="flex flex-wrap items-center gap-2">
          <UButton
            v-for="type in EVENT_TYPES"
            :key="type.value"
            size="xs"
            :variant="heatmap.selectedEventType.value === type.value ? 'solid' : 'soft'"
            color="neutral"
            @click="heatmap.selectedEventType.value = type.value"
          >
            {{ type.label }}
          </UButton>
          <label class="flex items-center gap-1 text-muted">
            -<input v-model.number="heatmap.eventWindowBeforeSeconds.value" type="number" min="0" max="120" class="w-12 rounded border border-border bg-background px-1" />s
          </label>
          <label class="flex items-center gap-1 text-muted">
            +<input v-model.number="heatmap.eventWindowAfterSeconds.value" type="number" min="0" max="120" class="w-12 rounded border border-border bg-background px-1" />s
          </label>
        </div>

        <label class="ml-auto flex items-center gap-1.5" :class="{ 'opacity-40': !sameMap }">
          <input v-model="heatmap.deltaMode.value" type="checkbox" :disabled="!sameMap" />
          Delta Heatmap (A − B)
        </label>
        <UButton size="xs" variant="ghost" color="neutral" @click="heatmap.resetViewTransform()">Réinitialiser la vue</UButton>
      </div>
      <p v-if="!sameMap" class="text-xs text-muted">Le Delta Heatmap nécessite deux parties sur la même carte.</p>

      <div v-if="heatmap.deltaMode.value" class="grid grid-cols-1">
        <HeatmapCompareDeltaPane
          :map-id="gameA.mapId"
          :grid-cols="heatmap.gridCols"
          :grid-rows="heatmap.gridRows"
          :positive-grid="deltaSplit.positive"
          :negative-grid="deltaSplit.negative"
          :view-transform="heatmap.viewTransform.value"
          @pan="heatmap.panBy"
          @zoom="heatmap.zoomBy"
        />
      </div>
      <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HeatmapComparePane
          :map-id="gameA.mapId"
          :grid-cols="heatmap.gridCols"
          :grid-rows="heatmap.gridRows"
          :palette-color-stops="GAME_A_PALETTE"
          :density-grid="heatmap.gridA.value"
          :path-points="heatmap.pathPointsA.value"
          :markers="deathMarkersA"
          :view-transform="heatmap.viewTransform.value"
          :hero-options="heroOptionsA"
          :selected-battletag="heatmap.selectedBattletagA.value"
          accent-text-class="text-info"
          title="Game A"
          @select-hero="(bt) => (heatmap.selectedBattletagA.value = bt)"
          @pan="heatmap.panBy"
          @zoom="heatmap.zoomBy"
        />
        <HeatmapComparePane
          :map-id="gameB.mapId"
          :grid-cols="heatmap.gridCols"
          :grid-rows="heatmap.gridRows"
          :palette-color-stops="GAME_B_PALETTE"
          :density-grid="heatmap.gridB.value"
          :path-points="heatmap.pathPointsB.value"
          :markers="deathMarkersB"
          :view-transform="heatmap.viewTransform.value"
          :hero-options="heroOptionsB"
          :selected-battletag="heatmap.selectedBattletagB.value"
          accent-text-class="text-danger"
          title="Game B"
          @select-hero="(bt) => (heatmap.selectedBattletagB.value = bt)"
          @pan="heatmap.panBy"
          @zoom="heatmap.zoomBy"
        />
      </div>
    </template>
  </div>
</template>
