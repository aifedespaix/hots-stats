import {
  FIGHT_CLUSTER_GAP_SECONDS,
  RESPAWN_PRESENCE_WINDOW_SECONDS,
  STAGGER_THRESHOLD_SECONDS,
  buildFightClusters,
  talentTierForLevel,
} from "@hots-stats/shared-types";
import type {
  MatchTimelineDeath,
  MatchTimelineLevelSnapshot,
  MatchTimelineStructureEvent,
} from "~/types/coach";
import type { MatchHeroTrajectory } from "~/types/spatial";
import { actorLabel, formatClock, playerInfoFor, type HeatmapPlayerLabels } from "./heatmapCellDetails";

/**
 * Pure "what happened here" math behind the kill/death recap the spatial
 * heatmap shows on hover and in its side panel (see `SpatialHeatmapView.vue`
 * and `SpatialEventRecapPanel.vue`).
 *
 * Kept out of the components for the same reason as `heatmapCellDetails.ts`:
 * the interesting rules -- which deaths count as "still down" at an instant,
 * what "nearby" means over a downsampled trajectory, how a level lead is read
 * off the snapshots, and how a fight's kill exchange is credited -- are worth
 * unit-testing on their own. Shared combat rules (respawn window, fight
 * clustering, stagger threshold, talent tiers) come from
 * `@hots-stats/shared-types` so the Coach pillars and this recap can never
 * disagree.
 *
 * Everything here is honest about missing data: a match without level
 * snapshots, structure events or trajectories yields null / `known: false`
 * fields that the UI drops, never an invented number.
 */

/** A hero's nearest trajectory sample counts as "there" only within this many
 * seconds of the event -- downsampled paths have no sample exactly at an
 * arbitrary second. */
export const PROXIMITY_WINDOW_SECONDS = 5;

/** "Nearby" on the normalized [0,1] map space: ~12% of the map's width, i.e.
 * roughly an ability's range plus a step. Deliberately generous -- the point is
 * "was this a fight or a pick", not exact geometry. */
export const PROXIMITY_RADIUS_NORMALIZED = 0.12;

/** A structure falling within this many seconds of a death is shown as its
 * context ("fort détruit juste après"). */
export const STRUCTURE_CONTEXT_WINDOW_SECONDS = 30;

export interface TeamStateSide {
  /** Distinct heroes of this side presumed still dead at the instant. */
  down: number;
  /** `5 - down`, clamped at 0 for a malformed death log. */
  present: number;
}

/** The two sides' state around one event, relative to the viewer's team. */
export interface EventTeamState {
  allies: TeamStateSide;
  enemies: TeamStateSide;
}

export interface EventProximity {
  /** Heroes of each side whose nearest sample sits within the radius. */
  allies: number;
  enemies: number;
  /** Distance (normalized map units) to the closest enemy hero around the
   * event, null when no enemy sample was close enough in time. */
  closestEnemyDistance: number | null;
  /** False when no trajectory sample was close enough in time to say anything
   * about where anyone stood. */
  known: boolean;
}

export interface EventAdvantage {
  allyLevel: number;
  enemyLevel: number;
  /** allyLevel - enemyLevel, positive when the viewer's team is ahead. */
  lead: number;
  /** Talent tier unlocked by the side's level (see TALENT_TIER_LEVELS). */
  allyTier: number;
  enemyTier: number;
}

export interface EventFightBilan {
  startSeconds: number;
  endSeconds: number;
  allyDeaths: number;
  enemyDeaths: number;
  /** Kills credited to each side inside the fight -- a death's credited killers
   * counted by their own side, so a 3-for-1 reads as "3 vs 1". */
  allyKills: number;
  enemyKills: number;
}

export interface EventRecap {
  atSeconds: number;
  /** M:SS game clock, same formatting as the chronology. */
  clock: string;
  /** Share of the match elapsed at that instant (0..1), null without a known
   * duration. */
  matchProgress: number | null;
  /** Relative to the viewer's team: "death" is one of ours, "kill" a pick on
   * the other side. Team 0 is the reference when the viewer's side is unknown. */
  kind: "kill" | "death";
  victimBattletag: string;
  victimTeam: 0 | 1;
  victimLabel: string;
  /** Credited killers, already decorated for display. */
  killers: { battletag: string; label: string; team: 0 | 1 }[];
  killType: "hero" | "other" | null;
  /** True for the earliest death of the whole match. */
  isFirstDeath: boolean;
  /** Seconds after the first teammate death of the same fight when this death
   * landed late enough to count as staggered, null otherwise. */
  staggerDelaySeconds: number | null;
  teamState: EventTeamState;
  proximity: EventProximity;
  advantage: EventAdvantage | null;
  /** Nearest structure destruction around the event, inside
   * STRUCTURE_CONTEXT_WINDOW_SECONDS. */
  structure: {
    atSeconds: number;
    structureType: MatchTimelineStructureEvent["structureType"];
    /** The *owning* team, i.e. the side that lost the structure. */
    team: 0 | 1;
    deltaSeconds: number;
  } | null;
  /** Kill exchange of the whole fight this event belongs to. */
  bilan: EventFightBilan;
}

/** Team 0 is the fallback reference, exactly like `buildScoreboardRows` does
 * when the viewer isn't a participant in the match. */
function referenceTeam(allyTeam: 0 | 1 | null | undefined): 0 | 1 {
  return allyTeam === 1 ? 1 : 0;
}

function teamOf(team: number): 0 | 1 {
  return team === 1 ? 1 : 0;
}

/**
 * Who of each side was presumed still dead at `atSeconds`: everyone whose own
 * death happened within `RESPAWN_PRESENCE_WINDOW_SECONDS` before it. Counts
 * distinct BattleTags, not raw deaths, so a player dying twice inside the window
 * is one missing player.
 *
 * `inclusive` folds in a death landing exactly at `atSeconds` -- the recap
 * wants the state *of* the kill it describes, i.e. with its own victim down.
 */
export function teamStateAt(
  deaths: readonly MatchTimelineDeath[],
  atSeconds: number,
  allyTeam: 0 | 1 | null,
  inclusive = false,
): EventTeamState {
  const reference = referenceTeam(allyTeam);
  const down: [Set<string>, Set<string>] = [new Set(), new Set()];

  for (const death of deaths) {
    const delta = atSeconds - death.atSeconds;
    if (delta < 0 || (!inclusive && delta === 0)) continue;
    if (delta > RESPAWN_PRESENCE_WINDOW_SECONDS) continue;
    down[teamOf(death.team)].add(death.battletag);
  }

  const side = (team: 0 | 1): TeamStateSide => {
    const count = down[team].size;
    return { down: count, present: Math.max(0, 5 - count) };
  };

  return { allies: side(reference), enemies: side(reference === 0 ? 1 : 0) };
}

/** The trajectory sample closest in time to `atSeconds`, or null when the
 * closest one is further away than the window. */
function closestSample(
  trajectory: MatchHeroTrajectory,
  atSeconds: number,
  windowSeconds: number,
): { x: number; y: number } | null {
  let bestIndex = -1;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (let i = 0; i < trajectory.atSeconds.length; i++) {
    const delta = Math.abs(trajectory.atSeconds[i]! - atSeconds);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestDelta > windowSeconds) return null;
  const x = trajectory.x[bestIndex];
  const y = trajectory.y[bestIndex];
  if (x === undefined || y === undefined) return null;
  return { x, y };
}

/**
 * Who was physically around a point at an instant, per side. Each hero
 * contributes its single closest-in-time sample inside the window (never an
 * interpolated position), so a hero crossing the area still counts, while one
 * whose last known position is seconds old -- or on another map layer -- does
 * not.
 */
export function nearbyTeamsAt(opts: {
  trajectories: readonly MatchHeroTrajectory[];
  atSeconds: number;
  x: number;
  y: number;
  allyTeam: 0 | 1 | null;
  /** Restricts the reading to one layer of a multi-layer map; omit to ignore layers. */
  layer?: string | null;
  radius?: number;
  windowSeconds?: number;
}): EventProximity {
  const reference = referenceTeam(opts.allyTeam);
  const radius = opts.radius ?? PROXIMITY_RADIUS_NORMALIZED;
  const windowSeconds = opts.windowSeconds ?? PROXIMITY_WINDOW_SECONDS;

  let allies = 0;
  let enemies = 0;
  let closestEnemyDistance: number | null = null;
  let known = false;

  for (const trajectory of opts.trajectories) {
    if (opts.layer !== undefined && (trajectory.layer ?? null) !== (opts.layer ?? null)) continue;
    const sample = closestSample(trajectory, opts.atSeconds, windowSeconds);
    if (!sample) continue;
    known = true;

    const distance = Math.hypot(sample.x - opts.x, sample.y - opts.y);
    if (distance > radius) continue;

    if (teamOf(trajectory.team ?? 0) === reference) {
      allies += 1;
    } else {
      enemies += 1;
      if (closestEnemyDistance === null || distance < closestEnemyDistance) closestEnemyDistance = distance;
    }
  }

  return { allies, enemies, closestEnemyDistance, known };
}

/** Mean of each team's latest known level at or before `atSeconds`, plus the
 * talent tiers that follow from it. Null while either side has no reading yet --
 * a one-sided "advantage" would be a fabrication. */
export function advantageAtSeconds(
  snapshots: readonly MatchTimelineLevelSnapshot[],
  teamByBattletag: ReadonlyMap<string, number>,
  atSeconds: number,
  allyTeam: 0 | 1 | null,
): EventAdvantage | null {
  const reference = referenceTeam(allyTeam);
  const latest: [Map<string, MatchTimelineLevelSnapshot>, Map<string, MatchTimelineLevelSnapshot>] = [
    new Map(),
    new Map(),
  ];

  for (const snapshot of snapshots) {
    if (snapshot.atSeconds > atSeconds) continue;
    const team = teamByBattletag.get(snapshot.battletag);
    if (team !== 0 && team !== 1) continue;
    const current = latest[team].get(snapshot.battletag);
    if (!current || snapshot.atSeconds >= current.atSeconds) latest[team].set(snapshot.battletag, snapshot);
  }

  const meanLevel = (entries: Map<string, MatchTimelineLevelSnapshot>): number | null => {
    if (entries.size === 0) return null;
    let sum = 0;
    for (const snapshot of entries.values()) sum += snapshot.level;
    return sum / entries.size;
  };

  const allyLevel = meanLevel(latest[reference]);
  const enemyLevel = meanLevel(latest[reference === 0 ? 1 : 0]);
  if (allyLevel === null || enemyLevel === null) return null;

  return {
    allyLevel,
    enemyLevel,
    lead: allyLevel - enemyLevel,
    allyTier: talentTierForLevel(allyLevel),
    enemyTier: talentTierForLevel(enemyLevel),
  };
}

/** `buildFightClusters` with a caller-chosen gap -- the shared helper hard-codes
 * the Coach pillar's own FIGHT_CLUSTER_GAP_SECONDS. */
function buildFightClustersWithGap(
  deaths: readonly MatchTimelineDeath[],
  gapSeconds: number,
): MatchTimelineDeath[][] {
  if (gapSeconds === FIGHT_CLUSTER_GAP_SECONDS) return buildFightClusters([...deaths]);

  const sorted = [...deaths].sort((a, b) => a.atSeconds - b.atSeconds);
  const clusters: MatchTimelineDeath[][] = [];
  for (const death of sorted) {
    const current = clusters.at(-1);
    const previous = current?.at(-1);
    if (current && previous && death.atSeconds - previous.atSeconds <= gapSeconds) current.push(death);
    else clusters.push([death]);
  }
  return clusters;
}

/**
 * The kill exchange of the fight (a gap-clustered run of deaths, same rule as
 * the Coach "talent delay" pillar) the event at `atSeconds` belongs to.
 *
 * A credited killer absent from `teamByBattletag` is credited to the victim's
 * opposing side: its BattleTag never matched a scoreboard row, but the death it
 * caused is still a kill for somebody, and that somebody is almost always the
 * enemy team.
 */
export function fightBilanAt(
  deaths: readonly MatchTimelineDeath[],
  atSeconds: number,
  allyTeam: 0 | 1 | null,
  teamByBattletag: ReadonlyMap<string, number>,
  gapSeconds = FIGHT_CLUSTER_GAP_SECONDS,
): EventFightBilan {
  const reference = referenceTeam(allyTeam);
  const cluster =
    buildFightClustersWithGap(deaths, gapSeconds).find((members) =>
      members.some((death) => death.atSeconds === atSeconds),
    ) ?? [];

  let allyDeaths = 0;
  let enemyDeaths = 0;
  let allyKills = 0;
  let enemyKills = 0;

  for (const death of cluster) {
    const victimTeam = teamOf(death.team);
    if (victimTeam === reference) allyDeaths += 1;
    else enemyDeaths += 1;

    for (const killer of death.killers ?? []) {
      const mapped = teamByBattletag.get(killer);
      const killerTeam = mapped === 0 || mapped === 1 ? mapped : victimTeam === 0 ? 1 : 0;
      if (killerTeam === reference) allyKills += 1;
      else enemyKills += 1;
    }
  }

  const times = cluster.map((death) => death.atSeconds);
  return {
    startSeconds: times.length > 0 ? Math.min(...times) : atSeconds,
    endSeconds: times.length > 0 ? Math.max(...times) : atSeconds,
    allyDeaths,
    enemyDeaths,
    allyKills,
    enemyKills,
  };
}

/** Which side a credited killer belongs to: the scoreboard's own team when its
 * BattleTag is known there, else the display label's side, else the victim's
 * opposing team (an unresolved killer still killed somebody). */
function killerTeamFor(
  battletag: string,
  teamByBattletag: ReadonlyMap<string, number>,
  labels: HeatmapPlayerLabels | undefined,
  reference: 0 | 1,
  fallback: 0 | 1,
): 0 | 1 {
  const mapped = teamByBattletag.get(battletag);
  if (mapped === 0 || mapped === 1) return mapped;
  const side = playerInfoFor(battletag, labels).side;
  if (side === "me" || side === "ally") return reference;
  if (side === "enemy") return reference === 0 ? 1 : 0;
  return fallback;
}

/** Seconds after the first teammate death of the same fight, when this death
 * landed more than STAGGER_THRESHOLD_SECONDS later; null otherwise (including
 * for the first teammate down, which has nothing to be staggered relative to). */
function staggerDelayFor(death: MatchTimelineDeath, clusters: MatchTimelineDeath[][]): number | null {
  const cluster = clusters.find((members) => members.includes(death));
  if (!cluster) return null;

  const teamDeaths = cluster
    .filter((member) => teamOf(member.team) === teamOf(death.team))
    .sort((a, b) => a.atSeconds - b.atSeconds);
  if (teamDeaths.length < 2) return null;

  const first = teamDeaths[0]!;
  if (first === death) return null;

  const delay = death.atSeconds - first.atSeconds;
  return delay > STAGGER_THRESHOLD_SECONDS ? delay : null;
}

/** The structure destruction closest in time to the event, inside the context
 * window. `deltaSeconds` is `structure.atSeconds - event.atSeconds`, so a
 * positive value means the structure fell *after* the death. */
function structureContextFor(
  events: readonly MatchTimelineStructureEvent[],
  atSeconds: number,
): EventRecap["structure"] {
  let best: EventRecap["structure"] = null;
  for (const event of events) {
    const delta = event.atSeconds - atSeconds;
    if (Math.abs(delta) > STRUCTURE_CONTEXT_WINDOW_SECONDS) continue;
    if (!best || Math.abs(delta) < Math.abs(best.deltaSeconds)) {
      best = {
        atSeconds: event.atSeconds,
        structureType: event.structureType,
        team: teamOf(event.team),
        deltaSeconds: delta,
      };
    }
  }
  return best;
}

/**
 * Builds the recap of every kill/death in `events`. `deaths` is the match's
 * whole death log (for the fight context, the team state and first blood), while
 * `events` are the ones to describe -- a hovered marker's cluster, or a cell's
 * deaths. Duplicates in `events` collapse into one recap; the result is
 * chronological.
 */
export function buildEventRecaps(opts: {
  deaths: readonly MatchTimelineDeath[];
  events: readonly MatchTimelineDeath[];
  playerLabels?: HeatmapPlayerLabels;
  allyTeam?: 0 | 1 | null;
  durationSeconds?: number;
  /** Every match participant, so a kill can be credited to a team even when the
   * displayed labels don't carry that side. */
  players?: readonly { battletag: string; team: number }[];
  levelSnapshots?: readonly MatchTimelineLevelSnapshot[];
  structureEvents?: readonly MatchTimelineStructureEvent[];
  trajectories?: readonly MatchHeroTrajectory[];
}): EventRecap[] {
  const allyTeam = opts.allyTeam ?? null;
  const reference = referenceTeam(allyTeam);
  const teamByBattletag = new Map<string, number>(
    (opts.players ?? []).map((player) => [player.battletag, teamOf(player.team)]),
  );
  const duration = opts.durationSeconds ?? 0;
  const fightClusters = buildFightClusters([...opts.deaths]);
  const firstDeathAt = opts.deaths.length > 0 ? Math.min(...opts.deaths.map((death) => death.atSeconds)) : null;

  const seen = new Set<string>();
  const recaps: EventRecap[] = [];

  for (const death of [...opts.events].sort((a, b) => a.atSeconds - b.atSeconds)) {
    const key = death.atSeconds + "|" + death.battletag;
    if (seen.has(key)) continue;
    seen.add(key);

    const victimTeam = teamOf(death.team);
    const killers = (death.killers ?? []).map((killer) => ({
      battletag: killer,
      label: actorLabel(killer, opts.playerLabels),
      team: killerTeamFor(killer, teamByBattletag, opts.playerLabels, reference, victimTeam === 0 ? 1 : 0),
    }));

    recaps.push({
      atSeconds: death.atSeconds,
      clock: formatClock(death.atSeconds),
      matchProgress: duration > 0 ? death.atSeconds / duration : null,
      kind: victimTeam === reference ? "death" : "kill",
      victimBattletag: death.battletag,
      victimTeam,
      victimLabel: actorLabel(death.battletag, opts.playerLabels),
      killers,
      killType: death.killType ?? null,
      isFirstDeath: firstDeathAt !== null && death.atSeconds === firstDeathAt,
      staggerDelaySeconds: staggerDelayFor(death, fightClusters),
      teamState: teamStateAt(opts.deaths, death.atSeconds, allyTeam, true),
      proximity: nearbyTeamsAt({
        trajectories: opts.trajectories ?? [],
        atSeconds: death.atSeconds,
        x: death.x ?? 0.5,
        y: death.y ?? 0.5,
        allyTeam,
        layer: death.layer === undefined ? undefined : death.layer ?? null,
      }),
      advantage: advantageAtSeconds(opts.levelSnapshots ?? [], teamByBattletag, death.atSeconds, allyTeam),
      structure: structureContextFor(opts.structureEvents ?? [], death.atSeconds),
      bilan: fightBilanAt(opts.deaths, death.atSeconds, allyTeam, teamByBattletag),
    });
  }

  return recaps;
}
