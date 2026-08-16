import { db, heroes, matchPlayers, matches, maps, users } from "@hots-stats/db";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

/**
 * `GET /_internal/diagnostics/uploads` -- breaks down who actually owns the
 * rows behind the "games" counts the web app shows (`matches.uploadedByUserId`
 * for distinct matches, `match_players` rows for the per-hero/global counts
 * that sum ~10 rows per match). Built to explain discrepancies like "personal
 * scope shows N games but global shows way more than N" without needing a
 * direct DATABASE_URL connection.
 */
export async function getUploadsDiagnostics() {
  const totalsRow = await db
    .select({
      totalMatches: sql<number>`count(distinct ${matches.id})::int`,
      totalMatchPlayers: sql<number>`count(${matchPlayers.id})::int`,
    })
    .from(matches)
    .leftJoin(matchPlayers, eq(matchPlayers.matchId, matches.id));
  const totals = totalsRow[0] ?? { totalMatches: 0, totalMatchPlayers: 0 };

  const byUploader = await db
    .select({
      uploadedByUserId: matches.uploadedByUserId,
      email: users.email,
      battletag: users.battletag,
      displayName: users.displayName,
      matchCount: sql<number>`count(*)::int`,
      firstUploadedAt: sql<string>`min(${matches.createdAt})`,
      lastUploadedAt: sql<string>`max(${matches.createdAt})`,
    })
    .from(matches)
    .leftJoin(users, eq(users.id, matches.uploadedByUserId))
    .groupBy(matches.uploadedByUserId, users.email, users.battletag, users.displayName)
    .orderBy(desc(sql`count(*)`));

  const byBattletagInMatchPlayers = await db
    .select({
      battletag: matchPlayers.battletag,
      userId: matchPlayers.userId,
      linkedEmail: users.email,
      rowCount: sql<number>`count(*)::int`,
      distinctMatches: sql<number>`count(distinct ${matchPlayers.matchId})::int`,
    })
    .from(matchPlayers)
    .leftJoin(users, eq(users.id, matchPlayers.userId))
    .groupBy(matchPlayers.battletag, matchPlayers.userId, users.email)
    .orderBy(desc(sql`count(*)`))
    .limit(50);

  const unlinkedBattletagRow = await db
    .select({ count: sql<number>`count(distinct ${matchPlayers.battletag})::int` })
    .from(matchPlayers)
    .where(isNull(matchPlayers.userId));

  return {
    totals,
    byUploader,
    topBattletagsInMatchPlayers: byBattletagInMatchPlayers,
    distinctUnlinkedBattletags: unlinkedBattletagRow[0]?.count ?? 0,
  };
}

/**
 * `GET /_internal/diagnostics/parser-versions` -- how many matches are still
 * stored under each `parserVersion`. Every parser-shape fix (see
 * `PARSER_VERSION`'s changelog in daemon-python/src/constants.py) only
 * self-heals a match once its owning player's daemon re-syncs it, which
 * needs the replay file still present locally and the daemon actually
 * having run since the fix shipped -- so this is the honest measure of "how
 * much of the DB is still on a build with a known parsing bug" instead of
 * assuming a deploy alone fixed everything.
 */
export async function getParserVersionOverview() {
  return db
    .select({
      parserVersion: matches.parserVersion,
      matchCount: sql<number>`count(*)::int`,
      oldestPlayedAt: sql<string>`min(${matches.playedAt})`,
      newestPlayedAt: sql<string>`max(${matches.playedAt})`,
    })
    .from(matches)
    .groupBy(matches.parserVersion)
    .orderBy(desc(sql`count(*)`));
}

/**
 * `GET /_internal/diagnostics/match/:matchId` -- raw per-player stats for
 * one match, for spot-checking a specific report ("this match's stats look
 * wrong") against what's actually stored, without needing a session/being a
 * participant (unlike `GET /matches/:id`, which is access-controlled).
 */
export async function getMatchDiagnostics(matchId: string) {
  const [match] = await db
    .select({
      id: matches.id,
      playedAt: matches.playedAt,
      durationSeconds: matches.durationSeconds,
      gameMode: matches.gameMode,
      mapName: maps.name,
      parserVersion: matches.parserVersion,
      gameVersion: matches.gameVersion,
    })
    .from(matches)
    .innerJoin(maps, eq(maps.id, matches.mapId))
    .where(eq(matches.id, matchId))
    .limit(1);

  if (!match) return null;

  const players = await db
    .select({
      battletag: matchPlayers.battletag,
      heroId: matchPlayers.heroId,
      heroName: heroes.name,
      team: matchPlayers.team,
      winner: matchPlayers.winner,
      kills: matchPlayers.kills,
      deaths: matchPlayers.deaths,
      assists: matchPlayers.assists,
      heroDamage: matchPlayers.heroDamage,
      siegeDamage: matchPlayers.siegeDamage,
      healing: matchPlayers.healing,
      selfHealing: matchPlayers.selfHealing,
      damageTaken: matchPlayers.damageTaken,
      experienceContribution: matchPlayers.experienceContribution,
    })
    .from(matchPlayers)
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .where(eq(matchPlayers.matchId, matchId))
    .orderBy(matchPlayers.team);

  return { match, players };
}

/**
 * `GET /_internal/diagnostics/zero-kda` -- investigates reports of a player
 * row showing 0 kills/deaths/assists despite a normal-looking game
 * (non-zero damage/healing, plausible duration). All three should be
 * essentially impossible to hit simultaneously in a real completed match, so
 * every row this returns is a live instance of that bug. Broken out by
 * parserVersion/heroId/gameMode to spot whether it's tied to a specific
 * daemon build, hero, or mode rather than eyeballing one match at a time.
 */
export async function getZeroKdaDiagnostics(limit: number) {
  const zeroKda = and(eq(matchPlayers.kills, 0), eq(matchPlayers.deaths, 0), eq(matchPlayers.assists, 0));

  const totalsRow = await db
    .select({
      totalMatchPlayers: sql<number>`count(*)::int`,
      zeroKdaCount: sql<number>`count(*) filter (where ${zeroKda})::int`,
    })
    .from(matchPlayers);

  const byParserVersion = await db
    .select({
      parserVersion: matches.parserVersion,
      count: sql<number>`count(*)::int`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(zeroKda)
    .groupBy(matches.parserVersion)
    .orderBy(desc(sql`count(*)`));

  const byHero = await db
    .select({
      heroId: matchPlayers.heroId,
      heroName: heroes.name,
      count: sql<number>`count(*)::int`,
    })
    .from(matchPlayers)
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .where(zeroKda)
    .groupBy(matchPlayers.heroId, heroes.name)
    .orderBy(desc(sql`count(*)`))
    .limit(20);

  const samples = await db
    .select({
      matchId: matches.id,
      playedAt: matches.playedAt,
      battletag: matchPlayers.battletag,
      heroId: matchPlayers.heroId,
      heroName: heroes.name,
      mapName: maps.name,
      gameMode: matches.gameMode,
      parserVersion: matches.parserVersion,
      gameVersion: matches.gameVersion,
      durationSeconds: matches.durationSeconds,
      heroDamage: matchPlayers.heroDamage,
      siegeDamage: matchPlayers.siegeDamage,
      healing: matchPlayers.healing,
      selfHealing: matchPlayers.selfHealing,
      damageTaken: matchPlayers.damageTaken,
      experienceContribution: matchPlayers.experienceContribution,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .innerJoin(maps, eq(maps.id, matches.mapId))
    .where(zeroKda)
    .orderBy(desc(matches.playedAt))
    .limit(limit);

  return {
    totals: totalsRow[0] ?? { totalMatchPlayers: 0, zeroKdaCount: 0 },
    byParserVersion,
    byHero,
    samples,
  };
}

/**
 * `GET /_internal/diagnostics/all-zero-matches` -- unlike `zero-kda` above
 * (per-player, and prone to false positives on a genuine low-fight
 * blowout), this flags a *whole match* where every single player is 0 on
 * every combat stat (kills/deaths/assists/damage/healing/experience) --
 * essentially impossible for a real, concluded, non-trivial-length game
 * (see `apps/api/src/lib/replay-plausibility.ts`'s `isAllZeroCombat`, the
 * same check `GET /matches/:id` uses for `statsReliable`).
 *
 * Root-caused in production (2026-08) to `daemon-python/src/parser.py`'s
 * `_build_protocol` falling back to the newest known `heroprotocol` decoder
 * for a replay build newer than any it has one for -- `SScoreResultEvent`
 * can decode without raising in that case, but with every player's stats
 * stuck at each field's baseline-0 seed. Fixed going forward as of
 * `PARSER_VERSION` 1.9 (raises `ReplayParseError` instead of silently
 * ingesting), but doesn't recover already-stored matches -- they can only
 * be recovered by an updated `heroprotocol` release with a real decoder for
 * their build, which this endpoint's `byGameVersion` breakdown helps
 * prioritize (the build(s) actually affecting real users).
 */
export async function getAllZeroMatchesDiagnostics(limit: number) {
  const durationFloorSeconds = 180;

  // Two round trips rather than one query with the group-by embedded as an
  // `IN (subquery)` -- simpler to get right, and this is a low-traffic
  // internal diagnostics endpoint, not a hot path worth the extra risk.
  const allZeroRows = await db
    .select({ matchId: matchPlayers.matchId })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(gte(matches.durationSeconds, durationFloorSeconds))
    .groupBy(matchPlayers.matchId)
    .having(
      sql`bool_and(
        ${matchPlayers.kills} = 0 and ${matchPlayers.deaths} = 0 and ${matchPlayers.assists} = 0 and
        ${matchPlayers.heroDamage} = 0 and ${matchPlayers.siegeDamage} = 0 and
        ${matchPlayers.healing} = 0 and ${matchPlayers.selfHealing} = 0 and ${matchPlayers.damageTaken} = 0
      )`,
    );
  const allZeroMatchIds = allZeroRows.map((row) => row.matchId);

  const [totalMatchesRow] = await db.select({ totalMatches: sql<number>`count(*)::int` }).from(matches);

  if (allZeroMatchIds.length === 0) {
    return {
      totals: { totalMatches: totalMatchesRow?.totalMatches ?? 0, allZeroMatchCount: 0 },
      byGameVersion: [],
      samples: [],
    };
  }

  const byGameVersion = await db
    .select({
      gameVersion: matches.gameVersion,
      parserVersion: matches.parserVersion,
      count: sql<number>`count(*)::int`,
    })
    .from(matches)
    .where(inArray(matches.id, allZeroMatchIds))
    .groupBy(matches.gameVersion, matches.parserVersion)
    .orderBy(desc(sql`count(*)`));

  const samples = await db
    .select({
      matchId: matches.id,
      playedAt: matches.playedAt,
      mapName: maps.name,
      gameMode: matches.gameMode,
      parserVersion: matches.parserVersion,
      gameVersion: matches.gameVersion,
      durationSeconds: matches.durationSeconds,
      uploadedByBattletag: users.battletag,
    })
    .from(matches)
    .innerJoin(maps, eq(maps.id, matches.mapId))
    .leftJoin(users, eq(users.id, matches.uploadedByUserId))
    .where(inArray(matches.id, allZeroMatchIds))
    .orderBy(desc(matches.playedAt))
    .limit(limit);

  return {
    totals: { totalMatches: totalMatchesRow?.totalMatches ?? 0, allZeroMatchCount: allZeroMatchIds.length },
    byGameVersion,
    samples,
  };
}
