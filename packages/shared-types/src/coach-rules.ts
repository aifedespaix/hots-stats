/**
 * Pure combat rules shared by the web Coach tab and the API's aggregation
 * services. No UI formatting and no web-only types live here, so both sides
 * import the exact same predicates and a rule can never drift between them.
 * Extracted from apps/web/app/utils/coachAnalysis.ts (Lot A1 of the Player
 * Progression suite).
 */

/** Minimal shapes: no UI formatting, no web-only types. */
export interface RuleDeath {
  battletag: string;
  team: 0 | 1;
  atSeconds: number;
}

export interface RuleLevelSnapshot {
  battletag: string;
  atSeconds: number;
  level: number;
}

export interface RuleSubject {
  battletag: string;
  team: 0 | 1;
  kills: number;
  deaths: number;
  assists: number;
}

/** HotS talent tiers are always unlocked at these character levels, in pick order. */
export const TALENT_TIER_LEVELS = [1, 4, 7, 10, 13, 16, 20] as const;

/** Deaths (across both teams) within this many seconds of the previous one
 * are treated as the same team fight -- a standard heuristic for turning a
 * flat death log into discrete engagements without needing position data. */
export const FIGHT_CLUSTER_GAP_SECONDS = 15;

/** How long a dead player is presumed "not yet back" for the sous-nombre
 * pillar. Approximation: HotS respawn timers actually scale with hero level
 * and game time; a flat window is a deliberate simplification pending that
 * exact data. */
export const RESPAWN_PRESENCE_WINDOW_SECONDS = 25;

/** A death arriving more than this long after the first teammate death in
 * the same fight cluster counts as "staggered" (isolated regroupment). */
export const STAGGER_THRESHOLD_SECONDS = 8;

/** Flat, documented respawn estimate backing the `timeDeadShare` aggregate.
 * Deliberately the same value as the sous-nombre window: the project refuses
 * to simulate real respawn timers, so `timeDeadShare` is a trend indicator,
 * never a stopwatch. Its tooltip says so. */
export const RESPAWN_ESTIMATE_SECONDS = RESPAWN_PRESENCE_WINDOW_SECONDS;

/** A subject death before this many seconds since gates open counts as "early". */
export const EARLY_DEATH_BEFORE_SECONDS = 300;

/** Highest talent tier unlocked at `level` (0 when no tier is reached yet),
 * consuming `TALENT_TIER_LEVELS` in pick order. */
export function talentTierForLevel(level: number): number {
  let tier = 0;
  for (const t of TALENT_TIER_LEVELS) {
    if (level >= t) tier = t;
  }
  return tier;
}

/** Groups a flat death log into team fights: deaths sorted by time, with a
 * new cluster whenever the gap to the previous death exceeds
 * `FIGHT_CLUSTER_GAP_SECONDS`. Returns the clusters in chronological order,
 * each one itself chronological. */
export function buildFightClusters<T extends { atSeconds: number }>(deaths: T[]): T[][] {
  const sorted = [...deaths].sort((a, b) => a.atSeconds - b.atSeconds);
  const clusters: T[][] = [];

  for (const death of sorted) {
    const current = clusters.at(-1);
    const previousDeath = current?.at(-1);
    if (current && previousDeath && death.atSeconds - previousDeath.atSeconds <= FIGHT_CLUSTER_GAP_SECONDS) {
      current.push(death);
    } else {
      clusters.push([death]);
    }
  }

  return clusters;
}

/** Latest level snapshot for `battletag` at or before `atSeconds`, or null
 * when no snapshot that early exists yet. */
export function levelAt(snapshots: RuleLevelSnapshot[], battletag: string, atSeconds: number): number | null {
  let best: RuleLevelSnapshot | null = null;
  for (const s of snapshots) {
    if (s.battletag !== battletag || s.atSeconds > atSeconds) continue;
    if (!best || s.atSeconds > best.atSeconds) best = s;
  }
  return best?.level ?? null;
}

/** Per-match, subject-relative flags. Each returns the count and the evaluated
 * denominator so an aggregate can sum both. */
export interface RuleCount {
  occurrences: number;
  evaluated: number;
}

/** Earliest death of the match (all 10 players) and whether it is the
 * subject's. `atSeconds` is null when the match has no death at all. */
export function firstDeathCount(
  deaths: RuleDeath[],
  subject: RuleSubject,
): { isFirst: boolean; atSeconds: number | null } {
  const firstDeath = [...deaths].sort((a, b) => a.atSeconds - b.atSeconds)[0];
  if (!firstDeath) return { isFirst: false, atSeconds: null };
  return { isFirst: firstDeath.battletag === subject.battletag, atSeconds: firstDeath.atSeconds };
}

/** Subject deaths before `beforeSeconds` since gates open. Only matches that
 * actually have a death log and stayed up for the whole window are
 * evaluated: a game shorter than the window never gave it a chance, and a
 * match with no death rows at all has nothing to read (never counted as "no
 * early death"). */
export function earlyDeathsCount(
  deaths: RuleDeath[],
  subject: RuleSubject,
  beforeSeconds: number,
  matchDuration: number,
): RuleCount {
  if (deaths.length === 0 || matchDuration < beforeSeconds) return { occurrences: 0, evaluated: 0 };
  const occurrences = deaths.filter((d) => d.battletag === subject.battletag && d.atSeconds < beforeSeconds).length;
  return { occurrences, evaluated: 1 };
}

/** One death the "sous-nombre" rule flags, with the present-player estimate
 * the display uses to explain it. */
export interface OutnumberedDeath {
  atSeconds: number;
  teammatesDown: number;
  enemiesDown: number;
  myTeamPresent: number;
  enemyPresent: number;
}

/** Deaths of `subject` where the estimated number of living teammates was
 * strictly below the living enemy count, given teammates/enemies who died
 * within `RESPAWN_PRESENCE_WINDOW_SECONDS` before. Counts distinct
 * battletags, not raw deaths: a player can die more than once inside the
 * window at low levels, where respawn timers are shortest. */
export function outnumberedDeaths(deaths: RuleDeath[], subject: RuleSubject): OutnumberedDeath[] {
  const myDeaths = deaths.filter((d) => d.battletag === subject.battletag);
  const result: OutnumberedDeath[] = [];

  for (const death of myDeaths) {
    const teammatesDown = new Set(
      deaths
        .filter(
          (d) =>
            d.team === death.team &&
            d.battletag !== death.battletag &&
            d.atSeconds < death.atSeconds &&
            death.atSeconds - d.atSeconds <= RESPAWN_PRESENCE_WINDOW_SECONDS,
        )
        .map((d) => d.battletag),
    ).size;
    const enemiesDown = new Set(
      deaths
        .filter(
          (d) =>
            d.team !== death.team &&
            d.atSeconds < death.atSeconds &&
            death.atSeconds - d.atSeconds <= RESPAWN_PRESENCE_WINDOW_SECONDS,
        )
        .map((d) => d.battletag),
    ).size;

    const myTeamPresent = 5 - teammatesDown;
    const enemyPresent = 5 - enemiesDown;
    if (myTeamPresent < enemyPresent) {
      result.push({ atSeconds: death.atSeconds, teammatesDown, enemiesDown, myTeamPresent, enemyPresent });
    }
  }

  return result;
}

export function outnumberedDeathsCount(deaths: RuleDeath[], subject: RuleSubject): RuleCount {
  return {
    occurrences: outnumberedDeaths(deaths, subject).length,
    evaluated: deaths.filter((d) => d.battletag === subject.battletag).length,
  };
}

/** One subject death flagged as "staggered" (isolated after the rest of the
 * team in the same fight). */
export interface StaggeredDeath {
  atSeconds: number;
  delaySeconds: number;
}

export interface StaggeredDeathsResult {
  events: StaggeredDeath[];
  /** Subject deaths sharing a fight with >= 1 other teammate death. */
  evaluated: number;
}

/** For each subject death in a fight where the team lost at least 2 players,
 * flags a death arriving more than `STAGGER_THRESHOLD_SECONDS` after the
 * first teammate death. The subject's own first-team death is evaluated but
 * never flagged -- it has nothing to be staggered relative to. */
export function staggeredDeathEvents(deaths: RuleDeath[], subject: RuleSubject): StaggeredDeathsResult {
  const myDeaths = deaths.filter((d) => d.battletag === subject.battletag);
  const clusters = buildFightClusters(deaths);
  const events: StaggeredDeath[] = [];
  let evaluated = 0;

  for (const death of myDeaths) {
    const cluster = clusters.find((c) => c.includes(death));
    if (!cluster) continue;
    const teamDeathsInCluster = cluster
      .filter((d) => d.team === subject.team)
      .sort((a, b) => a.atSeconds - b.atSeconds);
    if (teamDeathsInCluster.length < 2) continue;

    evaluated += 1;
    const firstTeamDeath = teamDeathsInCluster[0]!;
    if (firstTeamDeath.battletag === death.battletag) continue;

    const delay = death.atSeconds - firstTeamDeath.atSeconds;
    if (delay > STAGGER_THRESHOLD_SECONDS) {
      events.push({ atSeconds: death.atSeconds, delaySeconds: delay });
    }
  }

  return { events, evaluated };
}

export function staggeredDeathsCount(deaths: RuleDeath[], subject: RuleSubject): RuleCount {
  const { events, evaluated } = staggeredDeathEvents(deaths, subject);
  return { occurrences: events.length, evaluated };
}

/** One cross-team fight where the subject's talent tier was behind. */
export interface TalentDelayFight {
  atSeconds: number;
  myLevel: number;
  myTier: number;
  enemyAvgLevel: number;
  enemyTier: number;
}

export interface TalentDelayFightsResult {
  events: TalentDelayFight[];
  /** Cross-team fights where both the subject's and at least one enemy's
   * level could be read. */
  evaluated: number;
}

/** At the start of every fight involving both teams, compares the subject's
 * tier to the enemy team's average tier. Level-unknown fights are excluded
 * from the denominator, never counted as "on time". */
export function talentDelayFightEvents(
  deaths: RuleDeath[],
  snapshots: RuleLevelSnapshot[],
  subject: RuleSubject,
  enemyBattletags: string[],
): TalentDelayFightsResult {
  const clusters = buildFightClusters(deaths).filter(
    (c) => c.some((d) => d.team === subject.team) && c.some((d) => d.team !== subject.team),
  );
  const events: TalentDelayFight[] = [];
  let evaluated = 0;

  for (const cluster of clusters) {
    const startSeconds = cluster[0]!.atSeconds;
    const myLevel = levelAt(snapshots, subject.battletag, startSeconds);
    const enemyLevels = enemyBattletags
      .map((battletag) => levelAt(snapshots, battletag, startSeconds))
      .filter((l): l is number => l !== null);
    if (myLevel === null || enemyLevels.length === 0) continue;

    evaluated += 1;
    const enemyAvgLevel = enemyLevels.reduce((sum, l) => sum + l, 0) / enemyLevels.length;
    const myTier = talentTierForLevel(myLevel);
    const enemyTier = talentTierForLevel(enemyAvgLevel);
    if (myTier < enemyTier) {
      events.push({ atSeconds: startSeconds, myLevel, myTier, enemyAvgLevel, enemyTier });
    }
  }

  return { events, evaluated };
}

export function talentDelayFightsCount(
  deaths: RuleDeath[],
  snapshots: RuleLevelSnapshot[],
  subject: RuleSubject,
  enemyBattletags: string[],
): RuleCount {
  const { events, evaluated } = talentDelayFightEvents(deaths, snapshots, subject, enemyBattletags);
  return { occurrences: events.length, evaluated };
}
