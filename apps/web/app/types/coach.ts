import type { MatchDetailPlayer } from "./matches";

/**
 * Event-level replay data every timeline-dependent Coach pillar needs
 * (outnumbered fights, talent delay, staggered deaths, first death) --
 * `GET /matches/:id`'s `timeline` field, present for any match ingested
 * with PARSER_VERSION >= 1.4 (`daemon-python/src/parser.py`'s
 * `_extract_deaths`/`_extract_level_snapshots`), absent (not empty arrays)
 * for older matches.
 */
export interface MatchTimelineDeath {
  battletag: string;
  team: 0 | 1;
  atSeconds: number;
  // Present only when the map had a spatial calibration at ingestion time
  // (PARSER_VERSION >= 1.7) -- see tasks/epic-10-analyse-spatiale.md.
  x?: number;
  y?: number;
  killers?: string[];
  killType?: "hero" | "other";
  // Which layer of a multi-layer map (e.g. Haunted Mines' surface/mine) the
  // death occurred on -- null for a single-layer map, absent for a match
  // ingested before layer tracking existed.
  layer?: string | null;
}

export interface MatchTimelineLevelSnapshot {
  battletag: string;
  atSeconds: number;
  level: number;
}

/** A fort/keep/wall/core destruction -- `team` is the *owning* team (the
 * side that lost the structure). Present for a match ingested with
 * PARSER_VERSION >= 1.11 whose structure-destruction detection matched at
 * least one event; best-effort (see `matchStructureEventSchema` in
 * shared-types), so its absence doesn't imply anything about the match. An
 * event-anchor source for the Pro Comparison View
 * (`useHeatmapSync.ts`). */
export interface MatchTimelineStructureEvent {
  team: 0 | 1;
  atSeconds: number;
  structureType: "fort" | "keep" | "wall" | "core";
}

export interface MatchTimelineData {
  deaths: MatchTimelineDeath[];
  levelSnapshots: MatchTimelineLevelSnapshot[];
  structureEvents?: MatchTimelineStructureEvent[];
}

/** One point of the C2 chronology lead curve: both teams' mean level at
 * `atSeconds` (HotS levels are shared team-wide, so several snapshots at the
 * same timestamp are averaged) and their difference. */
export interface MatchTimelineLeadPoint {
  atSeconds: number;
  team0Level: number;
  team1Level: number;
  /** team0Level - team1Level; positive = team 0 ahead. */
  lead: number;
}

/** One death cluster on the chronology: one team's deaths within
 * `CLUSTER_TIME_WINDOW_SECONDS` of each other, collapsed into one marker
 * sized by `deaths`. Time-only (unlike `SpatialEventCluster`): a death with
 * no x/y still belongs on a chronology. */
export interface MatchTimelineDeathMarker {
  team: 0 | 1;
  /** Mean timestamp of the cluster's deaths. */
  atSeconds: number;
  deaths: number;
}

/** Everything `MatchTimelineChart.vue` draws for one match, derived only
 * from `MatchTimelineData` (no fabricated timeline). */
export interface MatchTimelineSeries {
  /** True only when both teams share a level snapshot in time; false makes
   * the tab show an explicit "données de niveau absentes" state instead of
   * an empty chart. */
  hasLevelData: boolean;
  /** Lead curve, ascending by `atSeconds`. */
  points: MatchTimelineLeadPoint[];
  /** Lead at the last shared snapshot; null when there is no point. */
  finalLead: number | null;
  deaths: MatchTimelineDeathMarker[];
  structures: MatchTimelineStructureEvent[];
}

/** French labels for the two sides, so the text alternative can name the
 * viewer's team instead of "équipe 0". */
export interface MatchTimelineTeamLabels {
  team0: string;
  team1: string;
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
