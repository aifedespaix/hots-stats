import {
  EARLY_DEATH_BEFORE_SECONDS,
  PROGRESSION_MIN_MATCHES,
  RESPAWN_ESTIMATE_SECONDS,
  earlyDeathsCount,
  firstDeathCount,
  outnumberedDeaths,
  staggeredDeathEvents,
  talentDelayFightEvents,
  type PatternAggregate,
  type PatternMatchPoint,
  type RuleDeath,
  type RuleLevelSnapshot,
  type RuleSubject,
} from "@hots-stats/shared-types";

/** One match's raw inputs, already scoped and filtered by the caller. */
export interface PatternMatchInput {
  matchId: string;
  playedAt: string;
  durationSeconds: number;
  winner: boolean;
  subject: RuleSubject;
  /** Every death in the match, both teams. */
  deaths: RuleDeath[];
  /** Every level snapshot in the match, both teams. */
  levelSnapshots: RuleLevelSnapshot[];
  /** Battletags of the team opposing `subject`. */
  enemyBattletags: string[];
  /** The match has at least one death or level-snapshot row. */
  hasTimeline: boolean;
  /** The match has at least one death row with a non-null x/y. */
  hasPositions: boolean;
}

/** Minimal roster row needed to resolve the subject of a match. */
export interface RosterPlayer {
  battletag: string;
  team: 0 | 1;
  kills: number;
  deaths: number;
  assists: number;
  winner: boolean;
}

/**
 * Picks the subject row for a match: the scope's first battletag present in
 * the roster. BattleTag casing is compared case-insensitively because it is
 * not stable across clients (the account selection normalizes it the same
 * way). Returns null when none of the scope's accounts played this match, so
 * a second user's match can never be selected. Pure, hence unit-testable
 * without a database.
 */
export function resolveSubject(roster: RosterPlayer[], battletags: string[]): RosterPlayer | null {
  const byLower = new Map(roster.map((player) => [player.battletag.toLowerCase(), player]));
  for (const battletag of battletags) {
    const player = byLower.get(battletag.toLowerCase());
    if (player) return player;
  }
  return null;
}

function rate(occurrences: number, evaluated: number): number {
  return evaluated > 0 ? occurrences / evaluated : 0;
}

/**
 * Sums the shared per-match rules over an ordered match list. Pure: no
 * database access. `perMatch` is returned in input order (the caller sorts
 * chronologically). A match with no timeline rows contributes to `matches`
 * and to the duration-weighted totals only -- never as "no first death".
 */
export function aggregatePatterns(matches: PatternMatchInput[]): PatternAggregate {
  const perMatch: PatternMatchPoint[] = [];

  let firstDeathOccurrences = 0;
  let firstDeathEvaluated = 0;
  let earlyDeathMatches = 0;
  let earlyDeathEvaluated = 0;
  let outnumberedOccurrences = 0;
  let outnumberedEvaluated = 0;
  let staggeredOccurrences = 0;
  let staggeredEvaluated = 0;
  let talentDelayOccurrences = 0;
  let talentDelayEvaluated = 0;
  let totalDeaths = 0;
  let totalDurationSeconds = 0;
  let withTimeline = 0;
  let withLevelSnapshots = 0;
  let withPositions = 0;

  for (const match of matches) {
    totalDeaths += match.subject.deaths;
    totalDurationSeconds += match.durationSeconds;
    if (match.hasTimeline) withTimeline += 1;
    if (match.levelSnapshots.length > 0) withLevelSnapshots += 1;
    if (match.hasPositions) withPositions += 1;

    const first = firstDeathCount(match.deaths, match.subject);
    if (match.deaths.length > 0) {
      firstDeathEvaluated += 1;
      if (first.isFirst) firstDeathOccurrences += 1;
    }

    const early = earlyDeathsCount(match.deaths, match.subject, EARLY_DEATH_BEFORE_SECONDS, match.durationSeconds);
    if (early.evaluated > 0) {
      earlyDeathEvaluated += early.evaluated;
      if (early.occurrences > 0) earlyDeathMatches += 1;
    }

    const outnumbered = outnumberedDeaths(match.deaths, match.subject);
    outnumberedOccurrences += outnumbered.length;
    outnumberedEvaluated += match.deaths.filter((d) => d.battletag === match.subject.battletag).length;

    const staggered = staggeredDeathEvents(match.deaths, match.subject);
    staggeredOccurrences += staggered.events.length;
    staggeredEvaluated += staggered.evaluated;

    const talentDelay = talentDelayFightEvents(match.deaths, match.levelSnapshots, match.subject, match.enemyBattletags);
    talentDelayOccurrences += talentDelay.events.length;
    talentDelayEvaluated += talentDelay.evaluated;

    perMatch.push({
      matchId: match.matchId,
      playedAt: match.playedAt,
      winner: match.winner,
      durationSeconds: match.durationSeconds,
      deaths: match.subject.deaths,
      isFirstDeath: first.isFirst,
      earlyDeaths: early.occurrences,
      outnumberedDeaths: outnumbered.length,
      staggeredDeaths: staggered.events.length,
      talentDelayFights: talentDelay.events.length,
    });
  }

  return {
    matches: matches.length,
    insufficientSample: matches.length < PROGRESSION_MIN_MATCHES,
    firstDeathRate: rate(firstDeathOccurrences, firstDeathEvaluated),
    earlyDeathRate: rate(earlyDeathMatches, earlyDeathEvaluated),
    outnumberedDeathRate: rate(outnumberedOccurrences, outnumberedEvaluated),
    outnumberedDeaths: outnumberedOccurrences,
    staggeredDeathRate: rate(staggeredOccurrences, staggeredEvaluated),
    staggeredDeaths: staggeredOccurrences,
    talentDelayRate: rate(talentDelayOccurrences, talentDelayEvaluated),
    talentDelayFights: talentDelayOccurrences,
    timeDeadShare: totalDurationSeconds > 0 ? (totalDeaths * RESPAWN_ESTIMATE_SECONDS) / totalDurationSeconds : 0,
    deathsPer10Min: totalDurationSeconds > 0 ? totalDeaths / (totalDurationSeconds / 600) : 0,
    perMatch,
    coverage: { withTimeline, withLevelSnapshots, withPositions },
  };
}

/** Zeroed aggregate used when the scope has no matching match. Exported so the
 * service and its callers share one canonical empty shape. */
export const EMPTY_PATTERN_AGGREGATE: PatternAggregate = {
  matches: 0,
  insufficientSample: true,
  firstDeathRate: 0,
  earlyDeathRate: 0,
  outnumberedDeathRate: 0,
  outnumberedDeaths: 0,
  staggeredDeathRate: 0,
  staggeredDeaths: 0,
  talentDelayRate: 0,
  talentDelayFights: 0,
  timeDeadShare: 0,
  deathsPer10Min: 0,
  perMatch: [],
  coverage: { withTimeline: 0, withLevelSnapshots: 0, withPositions: 0 },
};
