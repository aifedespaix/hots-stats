import { gridFromWireArrays, sumGrids } from "@hots-stats/shared-types";
import { type Ref, computed, ref } from "vue";
import type { MatchTimelineDeath } from "~/types/coach";
import type { MatchSlotHero } from "~/types/spatial";
import { buildSpatialEventPoints, clusterSpatialEvents } from "~/utils/deathClustering";
import { ALLY_TEAM_RGB, colorForHeroIndex, ENEMY_TEAM_RGB } from "~/utils/spatialColors";
import type { SpatialPresenceLayer } from "~/components/spatial/SpatialHeatmapView.vue";

export type MatchSlotViewMode = "hero" | "team";

/**
 * Reactive state + derived presence layers/marker clusters for one "Cette
 * partie" Slot (see tasks/epic-10-analyse-spatiale.md's Slot model) --
 * drives both Slots of `SpatialSlotGroup.vue` whenever either is scoped to
 * "Cette partie", so two independent instances of this logic can coexist
 * (one per Slot) without either forcing its own separate map image render.
 *
 * `colorOverride`, when set, forces every selected hero's presence into a
 * single merged layer of that one color -- the "2 Slots active" color rule
 * (fixed color per Slot, not per hero) from epic-10's charte de couleurs.
 * Leave it `undefined` for the standalone 1-Slot view, where each hero (or
 * each team, in `"team"` view mode) keeps its own color.
 */
export function useMatchSpatialSlot(
  heroes: MatchSlotHero[],
  deaths: MatchTimelineDeath[],
  activeLayer: Ref<string | null>,
  colorOverride?: Ref<[number, number, number] | undefined>,
) {
  // Everyone selected by default -- "superposition de tous les héros d'une
  // partie" per the Slot model, decocher individually from there.
  const selected = ref(new Set(heroes.map((h) => h.matchPlayerId)));

  function toggle(matchPlayerId: string) {
    const next = new Set(selected.value);
    if (next.has(matchPlayerId)) next.delete(matchPlayerId);
    else next.add(matchPlayerId);
    selected.value = next;
  }

  function selectAllies() {
    selected.value = new Set(heroes.filter((h) => h.isAlly).map((h) => h.matchPlayerId));
  }
  function selectEnemies() {
    selected.value = new Set(heroes.filter((h) => !h.isAlly).map((h) => h.matchPlayerId));
  }
  function selectAll() {
    selected.value = new Set(heroes.map((h) => h.matchPlayerId));
  }

  const activeHeroes = computed(() => heroes.filter((h) => selected.value.has(h.matchPlayerId)));
  const heroColorIndex = new Map(heroes.map((h, i) => [h.matchPlayerId, i]));

  const viewMode = ref<MatchSlotViewMode>("hero");

  function gridsFor(hero: MatchSlotHero) {
    return hero.layers.find((l) => l.layer === activeLayer.value);
  }

  const presenceLayers = computed<SpatialPresenceLayer[]>(() => {
    const override = colorOverride?.value;
    if (override) {
      return [
        {
          grid: sumGrids(activeHeroes.value.map((h) => gridFromWireArrays(gridsFor(h)?.presence.cellIndex ?? [], gridsFor(h)?.presence.values ?? []))),
          colorRgb: override,
        },
      ];
    }
    if (viewMode.value === "team") {
      const layers: SpatialPresenceLayer[] = [];
      const allies = activeHeroes.value.filter((h) => h.isAlly);
      const enemies = activeHeroes.value.filter((h) => !h.isAlly);
      if (allies.length > 0)
        layers.push({
          grid: sumGrids(allies.map((h) => gridFromWireArrays(gridsFor(h)?.presence.cellIndex ?? [], gridsFor(h)?.presence.values ?? []))),
          colorRgb: ALLY_TEAM_RGB,
          label: "Mon équipe",
        });
      if (enemies.length > 0)
        layers.push({
          grid: sumGrids(enemies.map((h) => gridFromWireArrays(gridsFor(h)?.presence.cellIndex ?? [], gridsFor(h)?.presence.values ?? []))),
          colorRgb: ENEMY_TEAM_RGB,
          label: "Adversaires",
        });
      return layers;
    }
    return activeHeroes.value
      .filter((hero) => gridsFor(hero) !== undefined)
      .map((hero) => ({
        grid: gridFromWireArrays(gridsFor(hero)!.presence.cellIndex, gridsFor(hero)!.presence.values),
        colorRgb: colorForHeroIndex(heroColorIndex.get(hero.matchPlayerId) ?? 0),
        label: hero.heroName,
      }));
  });

  const activeBattletags = computed(() => new Set(activeHeroes.value.map((h) => h.battletag)));
  const markerClusters = computed(() =>
    clusterSpatialEvents(buildSpatialEventPoints(deaths).filter((p) => activeBattletags.value.has(p.battletag) && p.layer === activeLayer.value)),
  );

  return { selected, toggle, selectAllies, selectEnemies, selectAll, activeHeroes, viewMode, presenceLayers, markerClusters };
}
