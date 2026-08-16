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
