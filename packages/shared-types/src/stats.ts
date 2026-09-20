import { z } from "zod";

/** Whether hero stats are computed from only the profile owner's matches, or every match the app has recorded. */
export const heroStatsScopeSchema = z.enum(["personal", "global"]);
export type HeroStatsScope = z.infer<typeof heroStatsScopeSchema>;

export interface HeroSummaryStats {
  heroId: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgKillParticipation: number;
}

export interface TalentTierStats {
  tier: 1 | 4 | 7 | 10 | 13 | 16 | 20;
  talentId: string;
  talentName: string;
  pickRate: number;
  winrate: number;
}

/** A connected user's win rate on one map, over their own ranked games only. */
export interface MapWeaknessStats {
  mapId: string;
  mapName: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
}

/** A connected user's win rate across their own ranked games where a given
 * *enemy* hero was on the opposing team -- "how do I do when I face X",
 * not "how does X perform overall". */
export interface MatchupWeaknessStats {
  heroId: string;
  heroName: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
}

/** A talent a user picks often at a given tier (their de facto default)
 * despite it underperforming relative to their own overall win rate on that
 * hero -- a habit worth reconsidering, not just a rarely-tried dud. */
export interface UnderperformingTalentStats {
  heroId: string;
  heroName: string;
  tier: 1 | 4 | 7 | 10 | 13 | 16 | 20;
  talentId: string;
  talentName: string;
  picks: number;
  /** Share of the user's own picks at this tier, for this hero, that are this talent. */
  pickRate: number;
  talentWinrate: number;
  /** The user's overall win rate on this hero (all talents), as the comparison baseline. */
  heroWinrate: number;
}

/** A talent a user picks often at a given tier (their de facto default)
 * that *outperforms* whatever else they picked instead at the same
 * tier/hero -- the mirror of `UnderperformingTalentStats`, surfaced as a
 * strength rather than a habit worth reconsidering. */
export type OverperformingTalentStats = UnderperformingTalentStats;

/** A weakness only counts as a "habit" worth flagging once picked at least
 * this many times -- one bad game with a rarely-tried talent isn't a pattern. */
export const TALENT_HABIT_MIN_PICKS = 3;
/** ...and only when it's the user's dominant choice at that tier (their
 * actual default), not a talent they're still experimenting with. */
export const TALENT_HABIT_MIN_PICK_RATE = 0.5;
/** Minimum win-rate gap (percentage points, as a ratio) below the hero's
 * overall win rate before an underperforming talent is worth surfacing. */
export const TALENT_HABIT_MIN_WINRATE_GAP = 0.15;

/** One *enemy* hero's aggregate performance against a given hero, across
 * every match where they were on opposing teams (scoped `personal`/`global`
 * like the rest of `heroes.ts` -- see `HeroStatsScope`). All `delta*` fields
 * compare this matchup's numbers to that hero's own overall baseline in the
 * same scope, isolating the matchup's specific effect (see
 * `HERO_MATCHUP_MIN_GAMES` doc and `tasks/epic-9-hero-matchups.md` for the
 * formula). `deltaHeroDamage`/`deltaDamageTaken`/`deltaExperienceContribution`
 * are *relative* deltas (ratio of the baseline, e.g. 0.08 = +8%) rather than
 * absolute differences -- unlike `deltaWinrate`/`deltaKillParticipation`,
 * those three underlying stats are raw counts, not 0-1 ratios, and their
 * scale varies wildly hero to hero, so only a relative delta reads
 * consistently. */
export interface HeroMatchupEntry {
  heroId: string;
  heroName: string;
  heroRole: string | null;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  /** winrate - baseline winrate, in ratio form (0.05 = +5 percentage points). */
  deltaWinrate: number;
  kda: number;
  deltaKda: number;
  avgKillParticipation: number;
  deltaKillParticipation: number;
  avgHeroDamage: number;
  deltaHeroDamage: number;
  avgDamageTaken: number;
  deltaDamageTaken: number;
  avgExperienceContribution: number;
  /** Relative to baseline (ratio, e.g. 0.08 = +8%) -- raw XP contribution, not a 0-1 share. */
  deltaExperienceContribution: number;
  /** True when `gamesPlayed` is below `HERO_MATCHUP_MIN_GAMES` -- still a
   * real (if noisy) data point, never dropped, but never used to rank
   * best/worst either. */
  smallSample: boolean;
}

/** Minimum games a hero-matchup entry needs before its delta is trusted for
 * the best/worst ranking -- entries below this still appear (flagged
 * `smallSample`), same backfill philosophy as `FaceAFaceHeroCombo`. Ranking
 * itself uses a Wilson score bound (see `apps/api/src/lib/wilson.ts`) rather
 * than raw winrate, so a 2-0 matchup can't out-rank a 40-game 58% one. */
export const HERO_MATCHUP_MIN_GAMES = 8;

export type PlayerFriendshipStatus = "none" | "friends" | "pending_outgoing" | "pending_incoming" | "self";

export interface PlayerEncounterStats {
  battletag: string;
  gamesTogether: number;
  gamesAsAlly: number;
  gamesAsOpponent: number;
  winsAsAlly: number;
  winsAsOpponent: number;
  // Set when this battletag belongs to a registered account, so the UI can offer to add them as a friend.
  accountUserId: string | null;
  friendshipStatus: PlayerFriendshipStatus;
  // This battletag's own record across every match it's in, independent of
  // the viewer (unlike the fields above, which are all scoped to matches
  // shared with the viewer) -- still respects the `mode` filter.
  globalGamesPlayed: number;
  globalWinrate: number;
  // K/D, not KDA -- null when deathless.
  globalKdRatio: number | null;
}

/** A hero needs at least this many games before it's eligible as a "signature
 * hero" ranking -- keeps one lucky game from parading as someone's best.
 * Kept distinct from `DRAFT_MIN_RANKED_GAMES_FOR_RANKING`: this codebase
 * keeps small-sample floors per-feature rather than sharing one constant. */
export const FACE_A_FACE_MIN_GAMES_FOR_SIGNATURE_HERO = 5;
/** Duo hero-combo samples are inherently smaller than solo hero samples
 * (they need both players on the same team on the same pick), so the floor
 * for a "best combo" ranking is lower than the signature-hero one. */
export const FACE_A_FACE_MIN_GAMES_FOR_COMBO = 2;

/** Account-wide (not per-hero) aggregate for one side of a Face-à-Face
 * comparison -- powers both the Tale of the Tape and the raw inputs to the
 * playstyle radar. Deliberately not scope-able to "global": a comparison
 * between two specific people only ever makes sense over their own games. */
export interface FaceAFaceOverviewStats {
  gamesPlayed: number;
  wins: number;
  winrate: number;
  totalDurationSeconds: number;
  avgDurationSeconds: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  kda: number;
  avgHeroDamage: number;
  avgSiegeDamage: number;
  avgHealing: number;
  avgDamageTaken: number;
  avgExperienceContribution: number;
  avgKillParticipation: number;
}

/** Share of a player's games spent on each hero role -- `role` is nullable
 * because a hero can have an unknown role (see heroes.ts's schema comment). */
export interface FaceAFaceRoleDistributionEntry {
  role: string | null;
  gamesPlayed: number;
  percentage: number;
}

export interface FaceAFaceSignatureHero {
  heroId: string;
  heroName: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  kda: number;
  /** True when this hero is a backfilled "most played" pick because fewer
   * than 3 heroes cleared `FACE_A_FACE_MIN_GAMES_FOR_SIGNATURE_HERO`. */
  smallSample: boolean;
}

/** One hero pairing the two players won/lost together while on the same team. */
export interface FaceAFaceHeroCombo {
  myHeroId: string;
  myHeroName: string;
  friendHeroId: string;
  friendHeroName: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  smallSample: boolean;
}

/** Stats for games where the two players were on the same team. */
export interface FaceAFaceSynergyStats {
  gamesPlayed: number;
  wins: number;
  winrate: number;
  /** Up to 3 best duo combos, best winrate first. Backfilled with the
   * most-played remaining combos (flagged `smallSample`) when fewer than 3
   * clear `FACE_A_FACE_MIN_GAMES_FOR_COMBO`, same rule as signature heroes --
   * empty only when the two players have never shared a team. */
  topCombos: FaceAFaceHeroCombo[];
}

/** Stats for games where the two players were on opposing teams -- the raw
 * material for "what should I pick against them" / "what do they beat me
 * with". Both lists use the same top-3-with-backfill rule as `topCombos`. */
export interface FaceAFaceMatchupStats {
  gamesPlayed: number;
  wins: number;
  winrate: number;
  /** Up to 3 of my hero picks with the best winrate against one of their
   * heroes -- my best counters. */
  bestMatchups: FaceAFaceHeroCombo[];
  /** Up to 3 of my hero picks with the worst winrate against one of their
   * heroes -- what to avoid drafting into them. */
  worstMatchups: FaceAFaceHeroCombo[];
}

export interface FaceAFacePlayerSide {
  /** Null when this side has no registered account -- comparisons work for
   * any battletag encountered in a recorded match, not just registered friends. */
  userId: string | null;
  displayName: string;
  avatarUrl: string | null;
  battletag: string | null;
  overview: FaceAFaceOverviewStats;
  roleDistribution: FaceAFaceRoleDistributionEntry[];
  signatureHeroes: FaceAFaceSignatureHero[];
}

// --- Maps Hub / map detail (Mission 2 -- see "Talents & Terrain" design doc) ---

/** One tile on the Maps Hub: every map the app knows about, with the
 * connected user's own ranked-games record on it. Unlike `MapWeaknessStats`
 * (meant to be browsed like a leaderboard of maps already played), a map
 * with zero personal games still gets a tile here -- the Hub is a menu, not
 * a ranking. */
export interface MapHubEntry {
  mapId: string;
  mapName: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  /** The user's last `MAP_HUB_RECENT_FORM_WINDOW` ranked games on this map,
   * chronological oldest-first (so a "form strip" reads left-to-right like a
   * timeline, most recent game on the right) -- true = win. Capped well
   * below `gamesPlayed` on purpose: this powers a compact glance indicator
   * on the Hub tile, not a full history (that's what the map detail page
   * and the "Suivi de la forme" widget are for). */
  recentForm: boolean[];
}

/** How many of the user's most recent ranked games (per map) feed the Hub
 * tile's form strip. */
export const MAP_HUB_RECENT_FORM_WINDOW = 10;

/** A hero's community-wide performance on one map (every recorded match,
 * not just the connected user's) -- the map detail page's "meta" table. */
export interface MapMetaHeroStats {
  heroId: string;
  heroName: string;
  heroRole: string | null;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  /** Share of this map's games (app-wide) where this hero was picked. */
  pickRate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
}

/** Minimum games (app-wide, not one user) a hero needs on a map before it's
 * eligible for the meta ranking -- global data pools quickly enough that an
 * ungated small sample would swamp the table with noise. */
export const MAP_META_MIN_GAMES = 10;

/** The connected user's own record with one hero, on one map. */
export interface MapPersonalHeroStats {
  heroId: string;
  heroName: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
}

/** Where this map ranks among every map the user has ranked games on, best
 * winrate first, plus the extremes of that same ranking for quick reference
 * ("3rd best map out of 15", "your worst map is X"). */
export interface MapPersonalRanking {
  gamesPlayed: number;
  wins: number;
  winrate: number;
  /** 1-based rank by winrate, best first; null once/if this map has no ranked games. */
  rank: number | null;
  totalRankedMaps: number;
  bestMap: MapWeaknessStats | null;
  worstMap: MapWeaknessStats | null;
}

/** One normalized component of the Team Impact score, expressed as a
 * percentile (0-100) against the reference population so stats on very
 * different scales (damage vs. healing vs. deaths) plot on one radar. See
 * `TeamImpactStats` for the reference population and composite formula. */
export interface TeamImpactComponent {
  key: "killParticipation" | "xp" | "survival" | "roleImpact";
  label: string;
  percentile: number;
}

/**
 * Composite "Impact d'Équipe" score (0-100) for the connected user on one
 * map, relative to other players of the same *dominant hero role* on that
 * same map (their own ranked games, most-played role there wins the tie).
 * Each raw rate stat (kill participation, XP/min, deaths/min, and a
 * role-specific stat -- damage for Assassins, healing for Healer/Support,
 * damage taken for Tank/Bruiser) is z-scored against that reference
 * population, then combined into a weighted composite and mapped through
 * the normal CDF to land on a friendly 0-100 scale. A phase-1 proxy: it
 * uses only fields already recorded per match (no timestamped teamfight
 * events yet), so e.g. `roleImpact` for tanks measures raw damage taken
 * rather than damage taken *specifically while contesting a fight*. Null
 * when the user has fewer than `TEAM_IMPACT_MIN_GAMES` ranked games in
 * their dominant role on this map.
 */
export interface TeamImpactStats {
  score: number;
  gamesPlayed: number;
  role: string | null;
  components: TeamImpactComponent[];
}

export const TEAM_IMPACT_MIN_GAMES = 5;

export interface SoakBucket {
  label: "Faible" | "Moyen" | "Fort";
  gamesPlayed: number;
  wins: number;
  winrate: number;
}

/**
 * Winrate bucketed by a relative "soak" proxy on this map: each of the
 * user's matches gets `zScore(xpPerMin) - zScore(killParticipation)`
 * (z-scored against their own ranked-games distribution on this map), then
 * matches are split into terciles by that score. A high bucket means "XP
 * generated despite low kill involvement" -- likely lane soak; a low bucket
 * means "XP mostly earned through combat". This is a proxy, not exact lane
 * XP: the replay tracker's per-source XP breakdown (couloir vs. combat)
 * isn't ingested yet (see design doc's data-model roadmap). Null when the
 * user has fewer than `SOAK_MIN_GAMES` ranked games on this map (too few to
 * split into three meaningful buckets).
 */
export interface SoakWinrateStats {
  buckets: SoakBucket[];
}

export const SOAK_MIN_GAMES = 9;

export interface MapDetailResponse {
  mapId: string;
  mapName: string;
  metaHeroes: MapMetaHeroStats[];
  personalHeroes: MapPersonalHeroStats[];
  personalRanking: MapPersonalRanking;
  teamImpact: TeamImpactStats | null;
  soak: SoakWinrateStats | null;
  /** Whether an admin has calibrated this map's world bounds (see /admin/calibrate) -- distinguishes "no spatial data yet because nobody's calibrated this map" from "calibrated, but no matches match the current filter". */
  spatialCalibrated: boolean;
}

// --- Talent Analyzer (Mission 1 -- see "Talents & Terrain" design doc) ---

export const TALENT_TIERS = [1, 4, 7, 10, 13, 16, 20] as const;
export type TalentTier = (typeof TALENT_TIERS)[number];

/** A talent pinned by the player while building a path -- narrows the
 * population every subsequent tier's stats are computed against. */
export interface TalentAnalyzerPin {
  tier: TalentTier;
  talentId: string;
}

/**
 * One talent option at one tier, within whatever population the currently
 * pinned tiers narrow it to. `wilsonLowerBound` (95% Wilson score interval,
 * lower bound) is the Analyzer's default sort key instead of raw `winrate`
 * -- a talent picked once and won reads 100% winrate but a near-zero Wilson
 * bound, so it no longer outranks a talent with a real sample. `reliable`
 * flags whether `picks` clears the caller's minimum-games floor (tunable in
 * the UI; see `TALENT_ANALYZER_MIN_GAMES_DEFAULT`) -- unreliable options are
 * still returned, never silently dropped, so the UI can gray/collapse them
 * instead of hiding data.
 */
export interface TalentAnalyzerOption {
  talentId: string;
  talentName: string;
  picks: number;
  /** Share of this tier's picks, within the current population, that are this talent. */
  pickRate: number;
  winrate: number;
  wilsonLowerBound: number;
  reliable: boolean;
}

export interface TalentAnalyzerTier {
  tier: TalentTier;
  options: TalentAnalyzerOption[];
}

/** One full (or partial) talent path, ranked for the "Top builds" leaderboard. */
export interface TalentAnalyzerBuild {
  picks: { tier: TalentTier; talentId: string; talentName: string }[];
  gamesPlayed: number;
  winrate: number;
  wilsonLowerBound: number;
}

export interface TalentAnalyzerResponse {
  /** Size of the population matching the hero/map/scope filters and every current pin. */
  gamesPlayed: number;
  tiers: TalentAnalyzerTier[];
  topBuilds: TalentAnalyzerBuild[];
}

/** Default "reliable" floor for a talent option's pick count -- same role as
 * `TALENT_HABIT_MIN_PICKS` elsewhere in this file, but surfaced as an
 * adjustable UI control here rather than a fixed threshold, since the
 * Analyzer is an exploration tool the player tunes themselves rather than a
 * fixed diagnostic. */
export const TALENT_ANALYZER_MIN_GAMES_DEFAULT = 10;
// --- Player progression suite (Lot A) ---
// Design: docs/superpowers/specs/2026-09-18-player-progression-design.md

/** Minimum matches before a progression aggregate may state a conclusion
 * instead of only its raw count. Shared so the API and the web can never
 * disagree on the gate. */
export const PROGRESSION_MIN_MATCHES = 20;

/** Minimum matches per side before a period-A-vs-period-B comparison may
 * state a conclusion. Shared for the same reason. */
export const PROGRESSION_MIN_PER_SIDE = 10;

/** Duration-weighted per-minute (and per-10-minute) rates (A2). Every field is
 * computed as `sum(stat) / (sum(durationSeconds) / unit)` across the matches in
 * the aggregate -- a weighted rate, never an average of per-match ratios, so a
 * 5-minute game and a 30-minute game do not weigh the same. All fields are 0
 * when the summed duration is not a positive number (empty scope, or corrupt
 * zero-duration rows), never NaN/Infinity. */
export interface NormalizedMetrics {
  xpPerMinute: number;
  heroDamagePerMinute: number;
  siegeDamagePerMinute: number;
  healingPerMinute: number;
  damageTakenPerMinute: number;
  deathsPer10Min: number;
  killsPer10Min: number;
  assistsPer10Min: number;
}

/** One match's contribution to the recurring combat-pattern aggregate (A1).
 * `perMatch` is chronological: it powers the trend line and lets the client
 * recompute a window without a second round-trip. */
export interface PatternMatchPoint {
  matchId: string;
  playedAt: string;
  winner: boolean;
  durationSeconds: number;
  deaths: number;
  isFirstDeath: boolean;
  earlyDeaths: number;
  outnumberedDeaths: number;
  staggeredDeaths: number;
  talentDelayFights: number;
}

/** Aggregated recurring combat patterns over a set of matches (A1). Every
 * per-pattern rate exposes its evaluated denominator through the accompanying
 * counts, and `coverage` records what the underlying replays could not
 * provide ("what we could not evaluate and why"). */
export interface PatternAggregate {
  /** Matches that contributed (all patterns share this denominator unless noted). */
  matches: number;
  /** True when matches < PROGRESSION_MIN_MATCHES (20): the UI must show the
   * count instead of a verdict. */
  insufficientSample: boolean;
  firstDeathRate: number;
  earlyDeathRate: number;
  outnumberedDeathRate: number;
  outnumberedDeaths: number;
  staggeredDeathRate: number;
  staggeredDeaths: number;
  talentDelayRate: number;
  talentDelayFights: number;
  timeDeadShare: number;
  deathsPer10Min: number;
  perMatch: PatternMatchPoint[];
  coverage: { withTimeline: number; withLevelSnapshots: number; withPositions: number };
}

export interface PatternsResponse {
  scope: "personal" | "global";
  aggregate: PatternAggregate;
  /** Set when the user filtered by hero/map/date. */
  filter: { heroId?: string; mapId?: string; from?: string; to?: string };
}

/** Default rolling window (in games) for the A3 trend series. Shared so the
 * API default and the web's later chart/legend cannot disagree. */
export const DEFAULT_TREND_WINDOW = 20;

/** One match's point on the rolling trend (A3). */
export interface TrendPoint {
  matchId: string;
  playedAt: string;
  winner: boolean;
  /** 1-based index within the returned series. */
  index: number;
  /** Rolling winrate over the last window games; null before it fills. */
  rollingWinrate: number | null;
  /** Rolling KDA over the same trailing window; null before it fills or when
   * the window has no death (never Infinity). */
  rollingKda: number | null;
  /** Rolling deaths per 10 minutes in the same trailing window; null before it
   * fills. Duration-weighted, like every A2 rate. */
  rollingDeathsPer10Min: number | null;
  gameVersion: string | null;
}

/** Duration-weighted aggregate over one period of the series (A3). kda is
 * null when the period has no death -- never Infinity. */
export interface PeriodStats {
  gamesPlayed: number;
  winrate: number;
  kda: number | null;
  deathsPer10Min: number;
  xpPerMinute: number;
}

/** Rolling trend response (A3). `comparison` is present only when the caller
 * passed a comparison boundary; `versionChanges` marks every known
 * gameVersion change inside the series. */
export interface TrendResponse {
  window: number;
  points: TrendPoint[];
  comparison?: { label: string; from: string; to: string; stats: PeriodStats }[];
  versionChanges: Array<{ atIndex: number; gameVersion: string; playedAt: string }>;
}

/** One metric's win-vs-loss contrast in the A4 outcome-driver analysis. */
export interface DriverMetric {
  key: string;
  /** French display label. */
  label: string;
  /** Direction in which the metric is "good" -- drives the colour, not the maths. */
  betterWhen: "higher" | "lower";
  meanInWins: number;
  meanInLosses: number;
  /** Cohen's d. Positive means the metric is higher in wins. */
  effectSize: number;
  winsSample: number;
  lossesSample: number;
  /** False when either side has fewer than PROGRESSION_MIN_PER_SIDE (10) matches. */
  reliable: boolean;
}

/** Outcome-driver response (A4). `drivers` never carries a metric whose source
 * data is entirely absent for the scope. */
export interface DriversResponse {
  scope: "personal" | "global";
  matches: number;
  /** Sorted by |effectSize| descending, reliable entries first. */
  drivers: DriverMetric[];
  methodology: string;
}

// --- Player progression suite (C4 — context breakdown) ---

/** Two consecutive matches belong to the same session while their start times
 * are at most this many minutes apart; beyond it the next match starts a new
 * session (89 minutes = one session, 91 = two). Shared so the API's clustering
 * and any UI copy cannot disagree. */
export const CONTEXT_SESSION_GAP_MINUTES = 90;

/** One bucket of a C4 context breakdown. `winrate` is 0 for an empty bucket --
 * `insufficientSample` is the flag the UI must honour instead of the rate. */
export interface ContextBucket {
  key: string;
  /** French display label. */
  label: string;
  gamesPlayed: number;
  wins: number;
  winrate: number;
  /** True when gamesPlayed < PROGRESSION_MIN_MATCHES (20). */
  insufficientSample: boolean;
}

/** One dimension of the C4 context breakdown. `dimension` is one of
 * "hour" | "weekday" | "sessionPosition" | "sessionSize" | "patch" |
 * "teamComposition". */
export interface ContextBreakdown {
  dimension: string;
  /** French display label. */
  label: string;
  buckets: ContextBucket[];
}

/** Response for `GET /stats/context` (C4). `tzOffsetMinutes` is the offset
 * east of UTC the buckets were computed in, echoed back so the UI can label
 * them. */
export interface ContextResponse {
  scope: "personal" | "global";
  matches: number;
  tzOffsetMinutes: number;
  breakdowns: ContextBreakdown[];
}

// --- Player progression suite (C3 — "Ton bourreau") ---

/** One killer identity in the C3 aggregation. `deaths` counts the subject deaths
 * this identity is credited with; a death with several credited killers counts
 * once per killer, so per-entry counts can sum above the total (the daemon emits
 * a single killer today, but the schema stores a list). `killerHeroId` /
 * `killerHeroName` are null when the credited battletag could not be matched to
 * the hero it played in that match. */
export interface KillerEntry {
  killerBattletag: string | null;
  killerHeroId: string | null;
  killerHeroName: string | null;
  deaths: number;
  /** Deaths credited to this killer as a share of totalDeaths (0..1). */
  share: number;
  /** Winrate of the subject over the matches where this killer killed them. */
  winrateWhenKilledBy: number;
}

/** Response for `GET /stats/killers` (C3). `totalDeaths` counts the subject's
 * death rows inside the requested scope/filters; the unattributed gap is
 * `totalDeaths - deathsWithKiller` (a death with an empty `killers` list, i.e.
 * `killType: "other"`). */
export interface KillersResponse {
  scope: "personal" | "global";
  totalDeaths: number;
  /** Deaths with at least one credited killer battletag. */
  deathsWithKiller: number;
  topKillers: KillerEntry[];
  topKillerHeroes: KillerEntry[];
}

// --- Player progression suite (E1 — Session recap) ---

/** One match inside a session recap (E1). Hero and map names are resolved at
 * the DB boundary so the recap renders without a second round-trip. */
export interface SessionRecapMatch {
  matchId: string;
  /** ISO datetime. */
  playedAt: string;
  winner: boolean;
  durationSeconds: number;
  heroId: string;
  heroName: string;
  mapId: string;
  mapName: string;
  kills: number;
  deaths: number;
  assists: number;
}

/** Record plus duration-weighted rates over one match set (E1). The rates reuse
 * the A2 rule; kda is null when the set has no death (never Infinity). */
export interface SessionRecapStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winrate: number;
  kda: number | null;
  deathsPer10Min: number;
  xpPerMinute: number;
}

/** Session-minus-baseline deltas (E1). kda is null when either side has no
 * death, so a delta is never fabricated from a missing ratio. */
export interface SessionBaselineDelta {
  winrate: number;
  kda: number | null;
  deathsPer10Min: number;
  xpPerMinute: number;
}

/** 95% half-width of the noise chance alone would produce in each
 * `SessionBaselineDelta` metric, on the same scale. Estimated from the spread
 * of the player's own pre-session matches, so a 5-game session gets the wide
 * band its size deserves instead of a false signal. A delta only says something
 * when its absolute value clears this band. */
export interface SessionDeltaNoise {
  /** Winrate half-width, in winrate points (0.44 = ±44 points). */
  winrate: number | null;
  /** Null exactly when the kda delta is null (either side has no death). */
  kda: number | null;
  /** Null when the baseline holds too few usable matches to estimate a spread. */
  deathsPer10Min: number | null;
  xpPerMinute: number | null;
}

/** One entry of the session picker: a session's identity and headline record,
 * without its matches. GET /stats/session returns one per selectable session so
 * the web picker can list them without a second round-trip; the 90-minute
 * boundary is the same `clusterSessions` rule that built the selected session. */
export interface SessionSummary {
  /** ISO datetime of the first match. */
  startedAt: string;
  /** ISO datetime of the last match. */
  endedAt: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
}

/** The selected session, oldest match first. */
export interface SessionRecap {
  /** ISO datetime of the first match. */
  startedAt: string;
  /** ISO datetime of the last match. */
  endedAt: string;
  matches: SessionRecapMatch[];
  stats: SessionRecapStats;
}

/** Response for GET /stats/session (E1). session is null when the scope has no
 * match at or after the requested at (or no match at all). baselineDelta is
 * exposed whenever there is a session AND a non-empty baseline: a thin sample
 * no longer suppresses it, it widens `deltaNoise` instead, so the UI can show
 * the gap next to the band chance alone would have produced. insufficientSample
 * stays as the "both sides clear PROGRESSION_MIN_MATCHES" notice. */
export interface SessionRecapResponse {
  scope: "personal" | "global";
  session: SessionRecap | null;
  /** Every selectable session, most recent first, so the web picker can offer
   * them without a second round-trip. Built from the same clustering that
   * produced `session`, so the two can never disagree. Empty when the scope
   * has no match at all. */
  sessions: SessionSummary[];
  /** One row per pre-session scope match, or null with no session. */
  baseline: SessionRecapStats | null;
  baselineDelta: SessionBaselineDelta | null;
  /** 95% noise band matching `baselineDelta` field by field, or null whenever
   * `baselineDelta` is null (no session, or no baseline to estimate a spread
   * from). */
  deltaNoise: SessionDeltaNoise | null;
  insufficientSample: boolean;
}

