import { db, heroRoleEnum, heroes, maps, matchPlayers, matches } from "@hots-stats/db";
import {
  DRAFT_RANKED_MODES,
  MAP_HUB_RECENT_FORM_WINDOW,
  MAP_META_MIN_GAMES,
  SOAK_MIN_GAMES,
  TEAM_IMPACT_MIN_GAMES,
  type MapDetailResponse,
  type MapHubEntry,
  type MapMetaHeroStats,
  type MapPersonalHeroStats,
  type MapPersonalRanking,
  type SoakBucket,
  type SoakWinrateStats,
  type TeamImpactStats,
} from "@hots-stats/shared-types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { normalCdf } from "../lib/normal-cdf";
import { wilsonLowerBound } from "../lib/wilson";
import { getMapWeaknesses } from "./weaknesses.service";

type HeroRole = (typeof heroRoleEnum.enumValues)[number];

/** Every map/hero query on this page is scoped to ranked games, same as
 * `weaknesses.service`'s -- mixing in Brawl/ARAM would muddy both the
 * community "meta" and the player's own diagnostics with modes that don't
 * reflect competitive play. */
function rankedModeCondition() {
  return inArray(matches.gameMode, [...DRAFT_RANKED_MODES]);
}

/**
 * The user's last `MAP_HUB_RECENT_FORM_WINDOW` ranked games per map,
 * chronological oldest-first -- powers the Hub tile's form strip. One
 * `row_number() over (partition by map)` query rather than N per-map
 * queries, so the Hub stays a single round trip regardless of how many maps
 * the app knows about.
 */
async function getRecentFormByMap(userId: string): Promise<Map<string, boolean[]>> {
  const ranked = db.$with("ranked_map_games").as(
    db
      .select({
        mapId: matches.mapId,
        winner: matchPlayers.winner,
        playedAt: matches.playedAt,
        rn: sql<number>`row_number() over (partition by ${matches.mapId} order by ${matches.playedAt} desc)`.as("rn"),
      })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.userId, userId), rankedModeCondition())),
  );

  const rows = await db
    .with(ranked)
    .select({ mapId: ranked.mapId, winner: ranked.winner })
    .from(ranked)
    .where(sql`${ranked.rn} <= ${MAP_HUB_RECENT_FORM_WINDOW}`)
    .orderBy(ranked.mapId, ranked.playedAt);

  const byMap = new Map<string, boolean[]>();
  for (const row of rows) {
    const list = byMap.get(row.mapId) ?? [];
    list.push(row.winner);
    byMap.set(row.mapId, list);
  }
  return byMap;
}

/**
 * All maps the app knows about, each with the connected user's own ranked
 * record -- the Hub's tile grid. A left join (via a personal-stats CTE)
 * keeps maps the user has never played in the list at 0 games, since the
 * Hub is a menu to browse, not a leaderboard of maps already played.
 */
export async function getMapHub(userId: string): Promise<MapHubEntry[]> {
  const personal = db.$with("personal_map_stats").as(
    db
      .select({
        mapId: matches.mapId,
        gamesPlayed: sql<number>`count(*)::int`.as("games_played"),
        wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`.as("wins"),
      })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.userId, userId), rankedModeCondition()))
      .groupBy(matches.mapId),
  );

  const [rows, recentFormByMap] = await Promise.all([
    db
      .with(personal)
      .select({
        mapId: maps.id,
        mapName: maps.name,
        gamesPlayed: sql<number>`coalesce(${personal.gamesPlayed}, 0)::int`,
        wins: sql<number>`coalesce(${personal.wins}, 0)::int`,
      })
      .from(maps)
      .leftJoin(personal, eq(personal.mapId, maps.id)),
    getRecentFormByMap(userId),
  ]);

  return rows
    .map((row) => ({
      ...row,
      winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0,
      recentForm: recentFormByMap.get(row.mapId) ?? [],
    }))
    .sort((a, b) => a.mapName.localeCompare(b.mapName));
}

/**
 * Community-wide (every recorded ranked match, not just this user's) hero
 * performance on one map -- the map detail page's "meta" table. Sorted by
 * Wilson lower bound rather than raw winrate, same anti-trap logic as the
 * Talent Analyzer: a hero with 2 lucky wins shouldn't outrank one with a
 * real sample. Heroes under `MAP_META_MIN_GAMES` (app-wide) are dropped
 * entirely rather than flagged -- unlike the Analyzer's own tunable floor,
 * this table has no per-row "your call" UI, so a fixed floor keeps it from
 * being swamped by single-digit-game noise.
 */
export async function getMapMetaHeroes(mapId: string): Promise<MapMetaHeroStats[]> {
  const rows = await db
    .select({
      heroId: matchPlayers.heroId,
      heroName: heroes.name,
      heroRole: heroes.role,
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
      avgKills: sql<number>`coalesce(avg(${matchPlayers.kills}), 0)::float`,
      avgDeaths: sql<number>`coalesce(avg(${matchPlayers.deaths}), 0)::float`,
      avgAssists: sql<number>`coalesce(avg(${matchPlayers.assists}), 0)::float`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .where(and(eq(matches.mapId, mapId), rankedModeCondition()))
    .groupBy(matchPlayers.heroId, heroes.name, heroes.role);

  // Denominator counts hero-picks (10 per match), which is exactly the right
  // base for "share of picks on this map", not a count of matches.
  const totalPicks = rows.reduce((sum, row) => sum + row.gamesPlayed, 0);

  return rows
    .filter((row) => row.gamesPlayed >= MAP_META_MIN_GAMES)
    .map((row) => ({
      ...row,
      winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0,
      pickRate: totalPicks > 0 ? row.gamesPlayed / totalPicks : 0,
    }))
    .sort((a, b) => wilsonLowerBound(b.wins, b.gamesPlayed) - wilsonLowerBound(a.wins, a.gamesPlayed));
}

/** The connected user's own heroes played on this map, most-played first. */
export async function getMapPersonalHeroes(userId: string, mapId: string): Promise<MapPersonalHeroStats[]> {
  const rows = await db
    .select({
      heroId: matchPlayers.heroId,
      heroName: heroes.name,
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
      avgKills: sql<number>`coalesce(avg(${matchPlayers.kills}), 0)::float`,
      avgDeaths: sql<number>`coalesce(avg(${matchPlayers.deaths}), 0)::float`,
      avgAssists: sql<number>`coalesce(avg(${matchPlayers.assists}), 0)::float`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .where(and(eq(matchPlayers.userId, userId), eq(matches.mapId, mapId), rankedModeCondition()))
    .groupBy(matchPlayers.heroId, heroes.name);

  return rows
    .map((row) => ({ ...row, winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0 }))
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed);
}

/** Reuses `getMapWeaknesses` (already the personal, ranked-only, per-map
 * winrate list used by the Diagnostic page) so the Hub, the Diagnostic
 * synthesis, and this ranking never disagree on "your winrate on map X". */
export async function getMapPersonalRanking(userId: string, mapId: string): Promise<MapPersonalRanking> {
  const byWinrate = (await getMapWeaknesses(userId)).sort((a, b) => b.winrate - a.winrate);
  const index = byWinrate.findIndex((entry) => entry.mapId === mapId);
  const thisMap = index >= 0 ? byWinrate[index] : undefined;

  return {
    gamesPlayed: thisMap?.gamesPlayed ?? 0,
    wins: thisMap?.wins ?? 0,
    winrate: thisMap?.winrate ?? 0,
    rank: index >= 0 ? index + 1 : null,
    totalRankedMaps: byWinrate.length,
    bestMap: byWinrate[0] ?? null,
    worstMap: byWinrate[byWinrate.length - 1] ?? null,
  };
}

function roleStatSql(role: HeroRole) {
  if (role === "Tank" || role === "Bruiser") return sql`${matchPlayers.damageTaken}`;
  if (role === "Healer" || role === "Support") return sql`(${matchPlayers.healing} + ${matchPlayers.selfHealing})`;
  return sql`${matchPlayers.heroDamage}`; // RangedAssassin / MeleeAssassin
}

function roleImpactLabel(role: HeroRole): string {
  if (role === "Tank" || role === "Bruiser") return "Dégâts encaissés";
  if (role === "Healer" || role === "Support") return "Soins prodigués";
  return "Dégâts infligés";
}

interface RoleMapAggregate {
  n: number;
  killPartAvg: number;
  killPartStd: number;
  xpAvg: number;
  xpStd: number;
  deathsAvg: number;
  deathsStd: number;
  roleAvg: number;
  roleStd: number;
}

/**
 * Mean and population stddev of the four Team Impact rate stats, for every
 * ranked game played with `role` on `mapId` -- app-wide when `userId` is
 * omitted (the reference population), or just this user's when given. Rates
 * are computed inline in SQL (per-minute, kill-participation against that
 * match's team total kills) and aggregated directly with `avg`/`stddev_pop`
 * rather than fetched per-row, since only the two moments are needed.
 */
async function roleMapAggregate(mapId: string, role: HeroRole, userId?: string): Promise<RoleMapAggregate> {
  const teamKills = db.$with("team_kills_impact").as(
    db
      .select({
        matchId: matchPlayers.matchId,
        team: matchPlayers.team,
        teamKills: sql<number>`sum(${matchPlayers.kills})`.as("team_kills"),
      })
      .from(matchPlayers)
      .groupBy(matchPlayers.matchId, matchPlayers.team),
  );

  const killPartExpr = sql`(${matchPlayers.kills} + ${matchPlayers.assists})::float / nullif(${teamKills.teamKills}, 0)`;
  const perMinute = sql`(${matches.durationSeconds}::float / 60)`;
  const xpPerMinExpr = sql`${matchPlayers.experienceContribution}::float / ${perMinute}`;
  const deathsPerMinExpr = sql`${matchPlayers.deaths}::float / ${perMinute}`;
  const roleStatPerMinExpr = sql`(${roleStatSql(role)})::float / ${perMinute}`;

  const conditions = [eq(matches.mapId, mapId), eq(heroes.role, role), rankedModeCondition()];
  if (userId) conditions.push(eq(matchPlayers.userId, userId));

  const [row] = await db
    .with(teamKills)
    .select({
      n: sql<number>`count(*)::int`,
      killPartAvg: sql<number>`coalesce(avg(${killPartExpr}), 0)::float`,
      killPartStd: sql<number>`coalesce(stddev_pop(${killPartExpr}), 0)::float`,
      xpAvg: sql<number>`coalesce(avg(${xpPerMinExpr}), 0)::float`,
      xpStd: sql<number>`coalesce(stddev_pop(${xpPerMinExpr}), 0)::float`,
      deathsAvg: sql<number>`coalesce(avg(${deathsPerMinExpr}), 0)::float`,
      deathsStd: sql<number>`coalesce(stddev_pop(${deathsPerMinExpr}), 0)::float`,
      roleAvg: sql<number>`coalesce(avg(${roleStatPerMinExpr}), 0)::float`,
      roleStd: sql<number>`coalesce(stddev_pop(${roleStatPerMinExpr}), 0)::float`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .innerJoin(teamKills, and(eq(teamKills.matchId, matchPlayers.matchId), eq(teamKills.team, matchPlayers.team)))
    .where(and(...conditions));

  return (
    row ?? {
      n: 0,
      killPartAvg: 0,
      killPartStd: 0,
      xpAvg: 0,
      xpStd: 0,
      deathsAvg: 0,
      deathsStd: 0,
      roleAvg: 0,
      roleStd: 0,
    }
  );
}

/** Fixed composite weights (kill participation, XP/min, survival, role-specific
 * stat) -- see the design doc's Mission 2 formula. Weights sum to 1; the
 * composite's own stddev under that weighting (assuming ~independent
 * components) is `sqrt(sum(weight^2))`, used below to rescale the composite
 * back to a roughly unit-variance z-score before it's fed to the normal CDF. */
const IMPACT_WEIGHTS = { killParticipation: 0.25, xp: 0.2, survival: 0.2, role: 0.35 } as const;
const IMPACT_COMPOSITE_STD = Math.sqrt(
  IMPACT_WEIGHTS.killParticipation ** 2 + IMPACT_WEIGHTS.xp ** 2 + IMPACT_WEIGHTS.survival ** 2 + IMPACT_WEIGHTS.role ** 2,
);

function zScore(value: number, mean: number, std: number): number {
  return std > 0 ? (value - mean) / std : 0;
}

/**
 * "Impact d'Équipe" for the connected user on one map: their four rate
 * stats, z-scored against every other ranked player of their own *dominant
 * hero role* on this same map, combined into a weighted composite and
 * mapped to a 0-100 percentile. A phase-1 proxy -- see `TeamImpactStats`'s
 * doc comment for the caveat about `roleImpact` not being teamfight-scoped
 * yet. Returns null below `TEAM_IMPACT_MIN_GAMES` in that role on this map.
 */
export async function getTeamImpactStats(userId: string, mapId: string): Promise<TeamImpactStats | null> {
  const [dominantRole] = await db
    .select({ role: heroes.role, gamesPlayed: sql<number>`count(*)::int` })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .where(and(eq(matchPlayers.userId, userId), eq(matches.mapId, mapId), rankedModeCondition()))
    .groupBy(heroes.role)
    .orderBy(sql`count(*) desc`)
    .limit(1);

  const role = dominantRole?.role;
  if (!role) return null;

  const [group, mine] = await Promise.all([roleMapAggregate(mapId, role), roleMapAggregate(mapId, role, userId)]);
  if (mine.n < TEAM_IMPACT_MIN_GAMES) return null;

  const zKillPart = zScore(mine.killPartAvg, group.killPartAvg, group.killPartStd);
  const zXp = zScore(mine.xpAvg, group.xpAvg, group.xpStd);
  const zSurvival = -zScore(mine.deathsAvg, group.deathsAvg, group.deathsStd);
  const zRole = zScore(mine.roleAvg, group.roleAvg, group.roleStd);

  const composite =
    IMPACT_WEIGHTS.killParticipation * zKillPart +
    IMPACT_WEIGHTS.xp * zXp +
    IMPACT_WEIGHTS.survival * zSurvival +
    IMPACT_WEIGHTS.role * zRole;

  return {
    score: Math.round(100 * normalCdf(composite / IMPACT_COMPOSITE_STD)),
    gamesPlayed: mine.n,
    role,
    components: [
      { key: "killParticipation", label: "Participation aux kills", percentile: Math.round(100 * normalCdf(zKillPart)) },
      { key: "xp", label: "XP générée", percentile: Math.round(100 * normalCdf(zXp)) },
      { key: "survival", label: "Survie", percentile: Math.round(100 * normalCdf(zSurvival)) },
      { key: "roleImpact", label: roleImpactLabel(role), percentile: Math.round(100 * normalCdf(zRole)) },
    ],
  };
}

interface SoakRow {
  winner: boolean;
  xpPerMin: number;
  killPart: number;
}

async function getSoakRows(userId: string, mapId: string): Promise<SoakRow[]> {
  const teamKills = db.$with("team_kills_soak").as(
    db
      .select({
        matchId: matchPlayers.matchId,
        team: matchPlayers.team,
        teamKills: sql<number>`sum(${matchPlayers.kills})`.as("team_kills"),
      })
      .from(matchPlayers)
      .groupBy(matchPlayers.matchId, matchPlayers.team),
  );

  return db
    .with(teamKills)
    .select({
      winner: matchPlayers.winner,
      xpPerMin: sql<number>`${matchPlayers.experienceContribution}::float / (${matches.durationSeconds}::float / 60)`,
      killPart: sql<number>`(${matchPlayers.kills} + ${matchPlayers.assists})::float / nullif(${teamKills.teamKills}, 0)`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(teamKills, and(eq(teamKills.matchId, matchPlayers.matchId), eq(teamKills.team, matchPlayers.team)))
    .where(and(eq(matchPlayers.userId, userId), eq(matches.mapId, mapId), rankedModeCondition()));
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function populationStd(values: number[], avg: number): number {
  return values.length > 0 ? Math.sqrt(mean(values.map((v) => (v - avg) ** 2))) : 0;
}

/**
 * Winrate bucketed by a relative soak proxy, terciled against the user's
 * own distribution of matches on this map -- see `SoakWinrateStats`'s doc
 * comment for the formula and its caveat. Returns null under `SOAK_MIN_GAMES`
 * (too few matches to split into three meaningful buckets).
 */
export async function getSoakWinrate(userId: string, mapId: string): Promise<SoakWinrateStats | null> {
  const rows = await getSoakRows(userId, mapId);
  if (rows.length < SOAK_MIN_GAMES) return null;

  const xpValues = rows.map((row) => row.xpPerMin);
  const killPartValues = rows.map((row) => row.killPart);
  const xpMean = mean(xpValues);
  const xpStd = populationStd(xpValues, xpMean);
  const killPartMean = mean(killPartValues);
  const killPartStd = populationStd(killPartValues, killPartMean);

  const scored = rows
    .map((row) => ({
      winner: row.winner,
      soakScore: zScore(row.xpPerMin, xpMean, xpStd) - zScore(row.killPart, killPartMean, killPartStd),
    }))
    .sort((a, b) => a.soakScore - b.soakScore);

  const bucketSize = Math.ceil(scored.length / 3);
  const grouped: Array<{ label: SoakBucket["label"]; rows: typeof scored }> = [
    { label: "Faible", rows: scored.slice(0, bucketSize) },
    { label: "Moyen", rows: scored.slice(bucketSize, bucketSize * 2) },
    { label: "Fort", rows: scored.slice(bucketSize * 2) },
  ];

  return {
    buckets: grouped.map(({ label, rows: bucketRows }) => {
      const wins = bucketRows.filter((row) => row.winner).length;
      return {
        label,
        gamesPlayed: bucketRows.length,
        wins,
        winrate: bucketRows.length > 0 ? wins / bucketRows.length : 0,
      };
    }),
  };
}

export async function getMapDetail(userId: string, mapId: string): Promise<MapDetailResponse | null> {
  const [mapRow] = await db.select({ id: maps.id, name: maps.name }).from(maps).where(eq(maps.id, mapId)).limit(1);
  if (!mapRow) return null;

  const [metaHeroes, personalHeroes, personalRanking, teamImpact, soak] = await Promise.all([
    getMapMetaHeroes(mapId),
    getMapPersonalHeroes(userId, mapId),
    getMapPersonalRanking(userId, mapId),
    getTeamImpactStats(userId, mapId),
    getSoakWinrate(userId, mapId),
  ]);

  return { mapId: mapRow.id, mapName: mapRow.name, metaHeroes, personalHeroes, personalRanking, teamImpact, soak };
}
