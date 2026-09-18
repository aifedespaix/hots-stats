import { gridFromWireArrays, sumGrids } from "@hots-stats/shared-types";
import { type ComputedRef, type Ref, computed, ref } from "vue";
import type { MatchTimelineDeath } from "~/types/coach";
import type { MatchSlotHero } from "~/types/spatial";
import { buildSpatialEventPoints, clusterSpatialEvents } from "~/utils/deathClustering";
import type { HeatmapPlayerInfo, HeatmapPlayerLabels, PlayerSide } from "~/utils/heatmapCellDetails";
import { isMine } from "~/utils/myAccounts";
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
 *
 * It also feeds the map's per-cell hover panel (`HeatmapCellTooltip.vue`):
 * `cellDeaths` and `playerLabels` are what let a cell say "Toi (Jaina) a tué
 * Kael'thas" instead of a bare count, so both are restricted to the same
 * heroes/layer the markers already respect.
 */
export function useMatchSpatialSlot(
  heroes: MatchSlotHero[],
  deaths: MatchTimelineDeath[],
  activeLayer: Ref<string | null>,
  colorOverride?: Ref<[number, number, number] | undefined>,
  // Every account the viewer owns, so "me" survives a merged/renamed BattleTag
  // (see utils/myAccounts.ts). Defaults to "nobody is me" for a caller that
  // doesn't know the viewer yet -- the hover panel then labels every hero by
  // side only.
  myBattletags: ComputedRef<Set<string>> | Ref<Set<string>> = computed(() => new Set<string>()),
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

  function sideFor(hero: MatchSlotHero): PlayerSide {
    if (isMine(hero.battletag, myBattletags.value)) return "me";
    return hero.isAlly ? "ally" : "enemy";
  }

  /** A merged layer can only claim a side when every selected hero shares one
   * (e.g. a whole-team selection); a mixed selection stays unlabelled rather
   * than picking a side that would be wrong for half of what it draws. */
  function uniformSide(list: MatchSlotHero[]): PlayerSide | undefined {
    const first = list[0];
    if (!first) return undefined;
    const side = sideFor(first);
    return list.every((hero) => sideFor(hero) === side) ? side : undefined;
  }

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
          side: uniformSide(activeHeroes.value),
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
        side: sideFor(hero),
      }));
  });

  const activeBattletags = computed(() => new Set(activeHeroes.value.map((h) => h.battletag)));
  const activeBattletagList = computed(() => [...activeBattletags.value]);
  const markerClusters = computed(() =>
    clusterSpatialEvents(buildSpatialEventPoints(deaths).filter((p) => activeBattletags.value.has(p.battletag) && p.layer === activeLayer.value)),
  );

  /** BattleTag -> hero name + side for every player of the match (not just the
   * selected ones): a hover line names the *other* side of a kill too. */
  const playerLabels = computed<HeatmapPlayerLabels>(() => {
    const labels: HeatmapPlayerLabels = {};
    for (const hero of heroes) {
      const info: HeatmapPlayerInfo = { name: hero.heroName, side: sideFor(hero) };
      labels[hero.battletag] = info;
      // Deaths and scoreboard rows both come from the same replay, but a
      // BattleTag's capitalization is not guaranteed to survive every join --
      // the case-insensitive copy makes the lookup total.
      labels[hero.battletag.toLowerCase()] = info;
    }
    return labels;
  });

  /** Deaths the hover panel attributes: on the active layer, positioned, and
   * involving at least one selected hero (as victim or killer) -- exactly the
   * events the markers draw, plus the "who" behind them. */
  const cellDeaths = computed(() =>
    deaths.filter(
      (death) =>
        death.x !== undefined &&
        death.y !== undefined &&
        (death.layer ?? null) === (activeLayer.value ?? null) &&
        (activeBattletags.value.has(death.battletag) ||
          (death.killers ?? []).some((killer) => activeBattletags.value.has(killer))),
    ),
  );

  return {
    selected,
    toggle,
    selectAllies,
    selectEnemies,
    selectAll,
    activeHeroes,
    viewMode,
    presenceLayers,
    markerClusters,
    activeBattletagList,
    playerLabels,
    cellDeaths,
  };
}
