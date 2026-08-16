/**
 * Static, per-map "first objective" spawn time -- an event anchor for the
 * Pro Comparison View (see `useHeatmapSync.ts`) alongside deaths and
 * structure destructions, computed with zero backend/parsing cost since
 * it's public game-design knowledge, not something derived from a replay.
 *
 * Deliberately limited to the *first* spawn only, not a repeating
 * schedule: most HotS maps' objective only has a truly fixed timer for its
 * first activation. Every subsequent one depends on emergent match state
 * (how long the fight over the previous objective took, when a boss/dragon/
 * mine-golem actually died) -- there is no fixed interval to compute
 * without reading real timeline events out of the replay, which this
 * feature doesn't have (only `timeline.deaths`/`structureEvents` are
 * per-match events today). Modeling a fake "every N seconds after the
 * first" cadence here would silently drift from the real, per-match timing
 * the further into the game you look -- worse than just not offering it.
 *
 * Sourced from community timing guides (heroesfire.com's map-timings guide,
 * cross-checked against Dignitas' map guide for Towers of Doom) as of
 * 2026-08 -- **approximate and patch-dependent**, since Blizzard has
 * adjusted these values across balance patches before. Re-verify before
 * trusting for anything beyond a rough visual anchor. A map with no entry
 * here (`null`) has no first-spawn UI -- primarily the four ARAM maps
 * (Braxis Outpost, Industrial District, Lost Cavern, Silver City), which
 * have no map-wide "capture point" objective in the same sense, and a
 * handful of Storm League maps (Battlefield of Eternity, Infernal Shrines,
 * Tomb of the Spider Queen, Volskaya Foundry, Warhead Junction, Braxis
 * Holdout, Hanamura Temple, Alterac Pass) not yet sourced -- add them here
 * once confirmed rather than guessing.
 */
export const FIRST_OBJECTIVE_SPAWN_SECONDS_BY_MAP: Record<string, number | null> = {
  "cursed-hollow": 70, // first Tribute window opens ~0:50-1:40 after gates open; midpoint used as a single anchor
  "dragon-shire": 75, // Dragon Shrines open at 1:15
  "towers-of-doom": 180, // first Battleground Objective activates at 3:00, after a 30s warning at 2:30
  "sky-temple": 90, // initial Temple activation at 1:30
  "blackheart-s-bay": 75, // Blackheart himself is capturable starting 1:15 (the doubloon chests spawn earlier, at 0:50, but aren't the map's namesake objective)
  "garden-of-terror": 90, // first night phase begins at 1:30
  "haunted-mines": 120, // the mine opens at 2:00

  "battlefield-of-eternity": null,
  "infernal-shrines": null,
  "tomb-of-the-spider-queen": null,
  "volskaya-foundry": null,
  "warhead-junction": null,
  "braxis-holdout": null,
  "hanamura-temple": null,
  "alterac-pass": null,
  "braxis-outpost": null,
  "industrial-district": null,
  "lost-cavern": null,
  "silver-city": null,
};

/** `mapId`'s first objective spawn time in seconds since gates open, or
 * `null` when unknown/not applicable (see the table's own doc comment) or
 * when it would fall after the match's own `durationSeconds` (a very short
 * game that ended before the objective ever spawned -- an anchor point
 * with no data on either side of it isn't useful). */
export function firstObjectiveSpawnSeconds(mapId: string, durationSeconds: number): number | null {
  const spawnSeconds = FIRST_OBJECTIVE_SPAWN_SECONDS_BY_MAP[mapId];
  if (spawnSeconds == null || spawnSeconds > durationSeconds) return null;
  return spawnSeconds;
}
