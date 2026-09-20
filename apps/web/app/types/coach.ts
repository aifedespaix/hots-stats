import type { MatchObjectiveEvent } from "@hots-stats/shared-types";
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
  /** Optional: absent for a match ingested before PARSER_VERSION 1.15. */
  objectives?: MatchObjectiveEvent[];
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

/** One team's mean level at one real snapshot timestamp -- the step function
 * `timelineStateAt` reads, never an interpolated point. */
export interface MatchTimelineLevelStep {
  atSeconds: number;
  level: number;
}

/** One player's row on the chronology: their own deaths, time-ordered. */
export interface MatchTimelineLane {
  battletag: string;
  /** Hero display name when the match page resolved it; null falls back to the battletag. */
  heroName: string | null;
  team: 0 | 1;
  isMe: boolean;
  deaths: MatchTimelineLaneDeath[];
}

/** One of a player's deaths, reduced to what the chronology plots (a player
 * can only die once per instant, so a lane position is always one death). */
export interface MatchTimelineLaneDeath {
  atSeconds: number;
  /** Credited killers, as the BattleTags the replay exposed (may be empty). */
  killers: string[];
  /** "hero" = killed by enemy heroes, "other" = minions/towers/etc.; null when the replay didn't record it. */
  killType: "hero" | "other" | null;
}

/** A death with its victim and killers resolved to display names -- what the
 * cursor's focus and the event rail read. */
export interface MatchTimelineStateDeath {
  battletag: string;
  heroName: string | null;
  team: 0 | 1;
  atSeconds: number;
  killers: string[];
  /** Killers resolved the same way `heroName` is; a BattleTag with no row in this match is kept as-is. */
  killerNames: string[];
  killType: "hero" | "other" | null;
}

/** Both event kinds in one time-ordered list, so "previous/next event" is a
 * single walk instead of two parallel cursors. */
export interface MatchTimelineEvent {
  kind: "death" | "structure";
  atSeconds: number;
  /** For a death, the victim's team; for a structure, the side that lost it. */
  team: 0 | 1;
  /** Death only. */
  battletag?: string;
  heroName?: string | null;
  /** Structure only. */
  structureType?: "fort" | "keep" | "wall" | "core";
}

/** What the game looked like at one instant: both teams' last known level
 * (carried forward -- never interpolated) and the events within reach. */
export interface MatchTimelineStateAt {
  atSeconds: number;
  team0Level: number | null;
  team1Level: number | null;
  /** team0Level - team1Level; null until both sides have a known level. */
  lead: number | null;
  deaths: MatchTimelineStateDeath[];
  structures: MatchTimelineStructureEvent[];
}

/** The death the cursor is on, plus every death of the same fight. */
export interface MatchTimelineFocus {
  victim: MatchTimelineStateDeath;
  fight: MatchTimelineStateDeath[];
}

/** Everything the chronology tab renders for one match, derived only from
 * `MatchTimelineData` (no fabricated timeline). */
export interface MatchTimelineSeries {
  /** True only when both teams share a level snapshot in time; false makes
   * the tab show an explicit "données de niveau absentes" state instead of
   * an empty chart. */
  hasLevelData: boolean;
  /** Lead curve, ascending by `atSeconds`. */
  points: MatchTimelineLeadPoint[];
  /** Lead at the last shared snapshot; null when there is no point. */
  finalLead: number | null;
  /** Each team's own level steps -- the raw material of `timelineStateAt`. */
  teamLevels: [MatchTimelineLevelStep[], MatchTimelineLevelStep[]];
  deaths: MatchTimelineDeathMarker[];
  structures: MatchTimelineStructureEvent[];
  /** Camps/objectives captured this match, time-ordered. */
  objectives: MatchObjectiveEvent[];
  /** One row per player: mine first, then my team, then the enemy team. */
  lanes: MatchTimelineLane[];
  /** Every death, time-ordered, with victims and killers resolved to names. */
  allDeaths: MatchTimelineStateDeath[];
  /** Deaths and structures merged, time-ordered -- powers prev/next event. */
  events: MatchTimelineEvent[];
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
