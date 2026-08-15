import type { MatchDetailPlayer } from "./matches";

/**
 * Event-level replay data every timeline-dependent Coach pillar needs
 * (outnumbered fights, talent delay, staggered deaths, first death).
 * `GET /matches/:id` does not send this yet -- `daemon-python/src/parser.py`
 * only forwards the end-of-game `SScoreResultEvent` (final box score), never
 * per-death timestamps or level-over-time snapshots. Modeled now so the
 * analyzer functions and cards in `utils/coachAnalysis.ts` are ready the
 * moment the ingestion pipeline grows a `timeline` field on the match
 * response -- see the Coach tab critique for the exact tracker events
 * (`SUnitDiedEvent`, periodic `SPlayerStatsEvent`) that would populate it.
 */
export interface MatchTimelineDeath {
  battletag: string;
  team: 0 | 1;
  atSeconds: number;
}

export interface MatchTimelineLevelSnapshot {
  battletag: string;
  atSeconds: number;
  level: number;
}

export interface MatchTimelineData {
  deaths: MatchTimelineDeath[];
  levelSnapshots: MatchTimelineLevelSnapshot[];
}

/** A player row enriched with match-relative ratios no single raw stat conveys on its own. */
export interface ScoreboardRow extends MatchDetailPlayer {
  /** (kills + assists) / team total kills -- 0 when the team has 0 kills. */
  killParticipation: number;
  /** heroDamage / max(deaths, 1). */
  damagePerDeath: number;
  /** experienceContribution / team total experienceContribution. */
  xpShare: number;
  isAlly: boolean;
  isMe: boolean;
}

export type TopPerformerCategory = "kills" | "heroDamage" | "siegeDamage" | "healing" | "damageTaken" | "experienceContribution";

export interface TopPerformerBadge {
  category: TopPerformerCategory;
  label: string;
  icon: string;
}

export type CoachVerdict = "positive" | "negative" | "neutral";

export type CoachPillar =
  | "efficiency"
  | "objectiveFootprint"
  | "outnumberedFights"
  | "talentDelay"
  | "staggeredDeaths"
  | "firstDeath";

export interface CoachOccurrence {
  /** Game-clock label, e.g. "12:34" -- only set for timeline-derived occurrences. */
  atLabel?: string;
  detail: string;
}

interface CoachInsightMeta {
  pillar: CoachPillar;
  icon: string;
  title: string;
  /** One-line, always-visible explanation of the rule -- shown so a competitive
   * player can judge the methodology, not just trust a black-box verdict. */
  methodology: string;
}

export interface CoachInsightReady extends CoachInsightMeta {
  status: "ready";
  verdict: CoachVerdict;
  summary: string;
  metricLabel?: string;
  metricValue?: string;
  occurrences?: CoachOccurrence[];
}

export interface CoachInsightUnavailable extends CoachInsightMeta {
  status: "unavailable";
  reason: string;
}

export type CoachInsightResult = CoachInsightReady | CoachInsightUnavailable;

export interface CoachAnalysisInput {
  me: ScoreboardRow;
  myTeam: ScoreboardRow[];
  enemyTeam: ScoreboardRow[];
  timeline: MatchTimelineData | null;
}
