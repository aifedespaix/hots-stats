import {
  type User,
  db,
  heroes,
  mapCalibrations,
  matchDeaths,
  matchLevelSnapshots,
  matchPlayers,
  matchSpatialGrids,
  matches,
  maps,
  talentPicks,
} from "@hots-stats/db";
import { UNKNOWN_GAME_VERSION, type Grid, gridToWireArrays } from "@hots-stats/shared-types";
import { and, asc, desc, eq, exists, gte, ilike, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import { gameModeListSchema, gameVersionListSchema } from "../lib/query";
import { authSession, requireUser } from "../middleware/auth-session";
import { getFriendshipStatuses } from "../services/friendships.service";

type Env = { Variables: { user: User } };

/** Column a `/matches` list result can be sorted by -- kept to columns already selected in the row shape below. */
const SORTABLE_COLUMNS = {
  playedAt: matches.playedAt,
  durationSeconds: matches.durationSeconds,
  gameMode: matches.gameMode,
  mapName: maps.name,
  heroName: heroes.name,
  winner: matchPlayers.winner,
} as const;

const playerSearchQuerySchema = z.object({
  q: z.string().trim().min(3),
});

/** Cap on `/matches/filters/players` results -- kept small since it backs a typeahead dropdown, not a full list. */
const PLAYER_SEARCH_LIMIT = 5;

const filtersQuerySchema = z.object({
  mode: gameModeListSchema.optional(),
  heroId: z.string().optional(),
  mapId: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  opponentBattletag: z.string().optional(),
  allyBattletag: z.string().optional(),
  opponentHeroId: z.string().optional(),
  gameVersion: gameVersionListSchema.optional(),
});

const listQuerySchema = filtersQuerySchema.extend({
  sortBy: z.enum(["playedAt", "durationSeconds", "gameMode", "mapName", "heroName", "winner"]).default("playedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
});

/**
 * `GET /matches/trend` filters, plus an optional `limit` -- the "form
 * tracker" widget's "Volume" mode ("les X dernières parties") caps the
 * window to the last N matches instead of a date range, unlike the plain
 * trend chart on the matches page which always wants the full filtered
 * history.
 */
const trendQuerySchema = filtersQuerySchema.extend({
  limit: z.coerce.number().int().positive().max(500).optional(),
});

/** Escapes ILIKE wildcards so a battletag search term is matched literally. */
function likeTerm(value: string): string {
  return `%${value.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Newest-first comparator for "major.minor.revision.baseBuild" strings
 * (see daemon-python/src/parser.py's `_game_version`) -- a plain string
 * sort would put "2.55.15..." before "2.55.9..." since "1" < "9". */
function compareGameVersionsDesc(a: string, b: string): number {
  const partsA = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const partsB = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsB[i] ?? 0) - (partsA[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Builds the same set of match filter conditions used by `GET /matches`,
 * shared with `GET /matches/trend` (win-rate evolution chart) so both
 * always agree on what a given set of filters matches.
 */
function buildMatchConditions(userId: string, filters: z.infer<typeof filtersQuerySchema>) {
  const { mode, heroId, mapId, dateFrom, dateTo, opponentBattletag, allyBattletag, opponentHeroId, gameVersion } =
    filters;
  const opponent = alias(matchPlayers, "opponent");
  const ally = alias(matchPlayers, "ally");

  const conditions = [eq(matchPlayers.userId, userId)];
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));
  if (heroId) conditions.push(eq(matchPlayers.heroId, heroId));
  if (mapId) conditions.push(eq(matches.mapId, mapId));
  if (gameVersion && gameVersion.length > 0) {
    const knownVersions = gameVersion.filter((v) => v !== UNKNOWN_GAME_VERSION);
    const versionConditions = [
      ...(knownVersions.length > 0 ? [inArray(matches.gameVersion, knownVersions)] : []),
      ...(gameVersion.includes(UNKNOWN_GAME_VERSION) ? [isNull(matches.gameVersion)] : []),
    ];
    // `versionConditions` is never empty here: `gameVersion` (validated
    // non-empty by `gameVersionListSchema`) is split into exactly these two
    // buckets above, so every entry lands in one or the other.
    conditions.push(or(...versionConditions)!);
  }
  if (dateFrom) conditions.push(gte(matches.playedAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(matches.playedAt, new Date(dateTo)));
  if (opponentBattletag) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(opponent)
          .where(
            and(eq(opponent.matchId, matches.id), ilike(opponent.battletag, likeTerm(opponentBattletag))),
          ),
      ),
    );
  }
  if (allyBattletag) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(ally)
          .where(
            and(
              eq(ally.matchId, matches.id),
              eq(ally.battletag, allyBattletag),
              eq(ally.team, matchPlayers.team),
            ),
          ),
      ),
    );
  }
  if (opponentHeroId) {
    const opponentHero = alias(matchPlayers, "opponent_hero");
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(opponentHero)
          .where(
            and(
              eq(opponentHero.matchId, matches.id),
              eq(opponentHero.heroId, opponentHeroId),
              ne(opponentHero.team, matchPlayers.team),
            ),
          ),
      ),
    );
  }

  return and(...conditions);
}

export const matchesRoute = new Hono<Env>()
  .use("*", authSession, requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { sortBy, sortDir, page, pageSize, ...filters } = parsed.data;
    const where = buildMatchConditions(user.id, filters);

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: matches.id,
          playedAt: matches.playedAt,
          durationSeconds: matches.durationSeconds,
          gameMode: matches.gameMode,
          gameVersion: matches.gameVersion,
          mapId: matches.mapId,
          mapName: maps.name,
          winner: matchPlayers.winner,
          heroId: matchPlayers.heroId,
          heroName: heroes.name,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .innerJoin(maps, eq(maps.id, matches.mapId))
        .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
        .where(where)
        .orderBy((sortDir === "asc" ? asc : desc)(SORTABLE_COLUMNS[sortBy]))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(where),
    ]);

    return c.json({ matches: rows, page, pageSize, total: countRows[0]?.count ?? 0 });
  })
  // Distinct heroes/maps the connected user has actually played with, to populate filter dropdowns.
  // Crossed-players aren't listed here -- that list can run into the
  // thousands, which used to make the "joueur croisé" dropdown render
  // every opponent ever faced and hang/crash the tab. See `/filters/players`
  // for the typeahead search that replaced it.
  .get("/filters", async (c) => {
    const user = c.get("user");

    const [heroRows, mapRows, versionRows] = await Promise.all([
      db
        .selectDistinct({ id: heroes.id, name: heroes.name })
        .from(matchPlayers)
        .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
        .where(eq(matchPlayers.userId, user.id))
        .orderBy(asc(heroes.name)),
      db
        .selectDistinct({ id: maps.id, name: maps.name })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .innerJoin(maps, eq(maps.id, matches.mapId))
        .where(eq(matchPlayers.userId, user.id))
        .orderBy(asc(maps.name)),
      db
        .selectDistinct({ gameVersion: matches.gameVersion })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(eq(matchPlayers.userId, user.id)),
    ]);

    // Sorted newest-first, with the `UNKNOWN_GAME_VERSION` sentinel
    // appended (never sorted alongside real versions) only when at least
    // one of this user's matches actually has no recorded version yet.
    const knownVersions = versionRows
      .map((row) => row.gameVersion)
      .filter((v): v is string => v !== null)
      .sort(compareGameVersionsDesc);
    const gameVersions = versionRows.some((row) => row.gameVersion === null)
      ? [...knownVersions, UNKNOWN_GAME_VERSION]
      : knownVersions;

    return c.json({ heroes: heroRows, maps: mapRows, gameVersions });
  })
  // Typeahead search for the "joueur croisé" filter: battletags of players
  // who've shared a match with the connected user, matching `q` (min 3
  // chars). Capped at PLAYER_SEARCH_LIMIT so the frontend never renders an
  // unbounded dropdown -- `hasMore` tells it to ask for more characters
  // instead of listing everything. The ILIKE below is served by a trigram
  // GIN index on match_players.battletag (see migration 0011).
  .get("/filters/players", async (c) => {
    const user = c.get("user");
    const parsed = playerSearchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const other = alias(matchPlayers, "other");

    const rows = await db
      .selectDistinct({ battletag: other.battletag })
      .from(matchPlayers)
      .innerJoin(other, and(eq(other.matchId, matchPlayers.matchId), ne(other.battletag, matchPlayers.battletag)))
      .where(and(eq(matchPlayers.userId, user.id), ilike(other.battletag, likeTerm(parsed.data.q))))
      .orderBy(asc(other.battletag))
      .limit(PLAYER_SEARCH_LIMIT + 1);

    return c.json({
      players: rows.slice(0, PLAYER_SEARCH_LIMIT).map((row) => row.battletag),
      hasMore: rows.length > PLAYER_SEARCH_LIMIT,
    });
  })
  // Every match matching the given filters (no pagination), ordered
  // chronologically, for the "win rate evolution" chart on the matches page
  // and the "form tracker" widget (heroes/maps/matches pages) -- it needs
  // the full filtered history, not just one page of it. With `limit`, only
  // the last N matches are returned (still chronological ascending) for the
  // form tracker's "Volume" mode.
  .get("/trend", async (c) => {
    const user = c.get("user");
    const parsed = trendQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { limit, ...filters } = parsed.data;
    const where = buildMatchConditions(user.id, filters);

    if (limit) {
      const lastN = await db
        .select({ playedAt: matches.playedAt, winner: matchPlayers.winner })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(where)
        .orderBy(desc(matches.playedAt))
        .limit(limit);

      return c.json({ points: lastN.reverse() });
    }

    const rows = await db
      .select({ playedAt: matches.playedAt, winner: matchPlayers.winner })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(where)
      .orderBy(asc(matches.playedAt));

    return c.json({ points: rows });
  })
  // Pre-aggregated stats for the "Dashboard" cards + charts on /matches --
  // same filters as the list/trend endpoints, but grouped server-side so
  // the UI never has to page through every match to build a ranking.
  .get("/dashboard", async (c) => {
    const user = c.get("user");
    const parsed = filtersQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const where = buildMatchConditions(user.id, parsed.data);

    // Per-match rate expressions shared by both the filtered aggregate and
    // the all-time range query below, so the radar chart's normalization
    // (filtered average mapped onto the user's own all-time min/max) always
    // compares like with like.
    const gameMinutes = sql`(${matches.durationSeconds}::float / 60.0)`;
    const damagePerMin = sql<number>`${matchPlayers.heroDamage}::float / nullif(${gameMinutes}, 0)`;
    const healingPerMin = sql<number>`${matchPlayers.healing}::float / nullif(${gameMinutes}, 0)`;
    const xpPerMin = sql<number>`${matchPlayers.experienceContribution}::float / nullif(${gameMinutes}, 0)`;
    const survivalMinutes = sql<number>`${gameMinutes} / greatest(${matchPlayers.deaths}, 1)`;

    const [overviewRows, roleRows, heroRows, mapRows, perfRows, perfRangeRows] = await Promise.all([
      db
        .select({
          gamesPlayed: sql<number>`count(*)::int`,
          wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
          avgKills: sql<number>`coalesce(avg(${matchPlayers.kills}), 0)::float`,
          avgDeaths: sql<number>`coalesce(avg(${matchPlayers.deaths}), 0)::float`,
          avgAssists: sql<number>`coalesce(avg(${matchPlayers.assists}), 0)::float`,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(where),
      db
        .select({
          role: heroes.role,
          gamesPlayed: sql<number>`count(*)::int`,
          wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
          totalDurationSeconds: sql<number>`coalesce(sum(${matches.durationSeconds}), 0)::int`,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
        .where(where)
        .groupBy(heroes.role),
      db
        .select({
          heroId: matchPlayers.heroId,
          heroName: heroes.name,
          heroRole: heroes.role,
          gamesPlayed: sql<number>`count(*)::int`,
          wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
        .where(where)
        .groupBy(matchPlayers.heroId, heroes.name, heroes.role)
        .orderBy(desc(sql`count(*)`))
        .limit(10),
      db
        .select({
          mapId: matches.mapId,
          mapName: maps.name,
          gamesPlayed: sql<number>`count(*)::int`,
          wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .innerJoin(maps, eq(maps.id, matches.mapId))
        .where(where)
        .groupBy(matches.mapId, maps.name),
      db
        .select({
          gamesPlayed: sql<number>`count(*)::int`,
          damagePerMin: sql<number>`coalesce(avg(${damagePerMin}), 0)::float`,
          healingPerMin: sql<number>`coalesce(avg(${healingPerMin}), 0)::float`,
          xpPerMin: sql<number>`coalesce(avg(${xpPerMin}), 0)::float`,
          survivalMinutes: sql<number>`coalesce(avg(${survivalMinutes}), 0)::float`,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(where),
      // All-time (unfiltered) range for the same user, used only to scale
      // the radar chart's axes to 0-100 -- not shown as its own stat.
      db
        .select({
          damageMin: sql<number>`coalesce(min(${damagePerMin}), 0)::float`,
          damageMax: sql<number>`coalesce(max(${damagePerMin}), 0)::float`,
          healingMin: sql<number>`coalesce(min(${healingPerMin}), 0)::float`,
          healingMax: sql<number>`coalesce(max(${healingPerMin}), 0)::float`,
          xpMin: sql<number>`coalesce(min(${xpPerMin}), 0)::float`,
          xpMax: sql<number>`coalesce(max(${xpPerMin}), 0)::float`,
          survivalMin: sql<number>`coalesce(min(${survivalMinutes}), 0)::float`,
          survivalMax: sql<number>`coalesce(max(${survivalMinutes}), 0)::float`,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .where(eq(matchPlayers.userId, user.id)),
    ]);

    const overview = overviewRows[0] ?? { gamesPlayed: 0, wins: 0, avgKills: 0, avgDeaths: 0, avgAssists: 0 };
    const gamesPlayed = overview.gamesPlayed;
    const wins = overview.wins;

    const perf = perfRows[0];
    const range = perfRangeRows[0];

    function normalize(value: number, min: number, max: number): number {
      if (max <= min) return value > 0 ? 100 : 0;
      return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
    }

    return c.json({
      overview: {
        gamesPlayed,
        wins,
        losses: gamesPlayed - wins,
        winrate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
        avgKills: overview.avgKills,
        avgDeaths: overview.avgDeaths,
        avgAssists: overview.avgAssists,
        kda: overview.avgDeaths > 0 ? (overview.avgKills + overview.avgAssists) / overview.avgDeaths : null,
      },
      roles: roleRows
        .map((row) => ({ ...row, winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0 }))
        .sort((a, b) => b.gamesPlayed - a.gamesPlayed),
      heroes: heroRows.map((row) => ({ ...row, winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0 })),
      maps: mapRows
        .map((row) => ({ ...row, winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0 }))
        .sort((a, b) => b.gamesPlayed - a.gamesPlayed),
      performance: {
        gamesPlayed: perf?.gamesPlayed ?? 0,
        damage: {
          value: perf?.damagePerMin ?? 0,
          normalized: normalize(perf?.damagePerMin ?? 0, range?.damageMin ?? 0, range?.damageMax ?? 0),
        },
        healing: {
          value: perf?.healingPerMin ?? 0,
          normalized: normalize(perf?.healingPerMin ?? 0, range?.healingMin ?? 0, range?.healingMax ?? 0),
        },
        xp: {
          value: perf?.xpPerMin ?? 0,
          normalized: normalize(perf?.xpPerMin ?? 0, range?.xpMin ?? 0, range?.xpMax ?? 0),
        },
        survival: {
          value: perf?.survivalMinutes ?? 0,
          normalized: normalize(perf?.survivalMinutes ?? 0, range?.survivalMin ?? 0, range?.survivalMax ?? 0),
        },
      },
    });
  })
  .get("/:id", async (c) => {
    const user = c.get("user");
    const matchId = c.req.param("id");

    const [match] = await db
      .select({
        id: matches.id,
        playedAt: matches.playedAt,
        durationSeconds: matches.durationSeconds,
        gameMode: matches.gameMode,
        mapId: matches.mapId,
        mapName: maps.name,
        region: matches.region,
      })
      .from(matches)
      .innerJoin(maps, eq(maps.id, matches.mapId))
      .where(eq(matches.id, matchId))
      .limit(1);

    if (!match) {
      return c.json({ error: "Match not found" }, 404);
    }

    const players = await db
      .select({
        id: matchPlayers.id,
        userId: matchPlayers.userId,
        battletag: matchPlayers.battletag,
        heroId: matchPlayers.heroId,
        heroName: heroes.name,
        heroRole: heroes.role,
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
      .orderBy(asc(matchPlayers.team));

    const isParticipant = players.some((p) => p.userId === user.id);
    if (!isParticipant) {
      // Not a participant yourself -- still allowed if you're friends with
      // one, e.g. browsing a friend's match history (GET /friends/:userId/matches
      // lists their games with no such restriction, so this detail route must
      // agree or every click into one of their non-shared games 404s).
      const participantIds = [...new Set(players.map((p) => p.userId).filter((id): id is string => id !== null))];
      const statuses = await getFriendshipStatuses(user.id, participantIds);
      const viewerIsFriendOfSomeone = [...statuses.values()].some((status) => status === "friends");
      if (!viewerIsFriendOfSomeone) {
        return c.json({ error: "Match not found" }, 404);
      }
    }

    const playerIds = players.map((p) => p.id);
    const talents =
      playerIds.length > 0
        ? await db
            .select({
              matchPlayerId: talentPicks.matchPlayerId,
              tier: talentPicks.tier,
              talentId: talentPicks.talentId,
              talentName: talentPicks.talentName,
            })
            .from(talentPicks)
            .where(inArray(talentPicks.matchPlayerId, playerIds))
            .orderBy(asc(talentPicks.tier))
        : [];

    const talentsByPlayer = new Map<string, typeof talents>();
    for (const talent of talents) {
      const list = talentsByPlayer.get(talent.matchPlayerId) ?? [];
      list.push(talent);
      talentsByPlayer.set(talent.matchPlayerId, list);
    }

    const playersWithTalents = players.map((p) => ({
      ...p,
      talents: (talentsByPlayer.get(p.id) ?? []).map((t) => ({
        tier: t.tier,
        talentId: t.talentId,
        talentName: t.talentName,
      })),
    }));

    // Only matches ingested with PARSER_VERSION >= 1.4 have any rows here --
    // `timeline` is omitted entirely (not sent as empty arrays) for older
    // matches, so the Coach tab correctly shows "unavailable" for them
    // instead of misreading "no rows yet" as "no deaths this match".
    // `spatial` (match_spatial_grids) is separately gated on PARSER_VERSION
    // >= 1.7 *and* the map having had a calibration at ingestion time --
    // see spatial-rollup.service.ts / replay-upsert.service.ts.
    const [deathRows, levelSnapshotRows, spatialGridRows, calibrationRows] = await Promise.all([
      playerIds.length > 0
        ? db
            .select({
              matchPlayerId: matchDeaths.matchPlayerId,
              atSeconds: matchDeaths.atSeconds,
              x: matchDeaths.x,
              y: matchDeaths.y,
              killers: matchDeaths.killers,
              killType: matchDeaths.killType,
            })
            .from(matchDeaths)
            .where(inArray(matchDeaths.matchPlayerId, playerIds))
        : Promise.resolve([]),
      playerIds.length > 0
        ? db
            .select({
              matchPlayerId: matchLevelSnapshots.matchPlayerId,
              atSeconds: matchLevelSnapshots.atSeconds,
              level: matchLevelSnapshots.level,
            })
            .from(matchLevelSnapshots)
            .where(inArray(matchLevelSnapshots.matchPlayerId, playerIds))
        : Promise.resolve([]),
      playerIds.length > 0
        ? db
            .select({
              matchPlayerId: matchSpatialGrids.matchPlayerId,
              gridCols: matchSpatialGrids.gridCols,
              gridRows: matchSpatialGrids.gridRows,
              presenceGrid: matchSpatialGrids.presenceGrid,
              killsGrid: matchSpatialGrids.killsGrid,
              deathsGrid: matchSpatialGrids.deathsGrid,
            })
            .from(matchSpatialGrids)
            .where(inArray(matchSpatialGrids.matchPlayerId, playerIds))
        : Promise.resolve([]),
      // Independent of playerIds -- whether *the map* has ever been
      // calibrated (see /admin/calibrate), regardless of whether this
      // specific match has any spatial rows. Lets the frontend tell "this
      // map isn't calibrated yet" apart from "this match predates spatial
      // tracking", instead of one generic empty state for both.
      db.select({ mapId: mapCalibrations.mapId }).from(mapCalibrations).where(eq(mapCalibrations.mapId, match.mapId)).limit(1),
    ]);

    const playerById = new Map(players.map((p) => [p.id, p]));
    const timeline =
      deathRows.length > 0 || levelSnapshotRows.length > 0
        ? {
            deaths: deathRows.flatMap((d) => {
              const player = playerById.get(d.matchPlayerId);
              if (!player) return [];
              return [
                {
                  battletag: player.battletag,
                  team: player.team,
                  atSeconds: d.atSeconds,
                  ...(d.x !== null && d.y !== null ? { x: d.x, y: d.y } : {}),
                  ...(d.killType ? { killers: d.killers ?? [], killType: d.killType } : {}),
                },
              ];
            }),
            levelSnapshots: levelSnapshotRows.flatMap((s) => {
              const player = playerById.get(s.matchPlayerId);
              return player ? [{ battletag: player.battletag, atSeconds: s.atSeconds, level: s.level }] : [];
            }),
          }
        : undefined;

    // One grid per hero that has one -- lets the frontend's "Cette partie"
    // Slot toggle heroes individually (see
    // tasks/epic-10-analyse-spatiale.md's Slot model). `null` (field
    // omitted) rather than an empty array when no hero in this match has
    // spatial data, same "absent, not empty" convention as `timeline`.
    const spatial =
      spatialGridRows.length > 0
        ? {
            grid: { cols: spatialGridRows[0]!.gridCols, rows: spatialGridRows[0]!.gridRows },
            heroes: spatialGridRows.map((row) => {
              const player = playerById.get(row.matchPlayerId);
              return {
                matchPlayerId: row.matchPlayerId,
                battletag: player?.battletag ?? null,
                heroId: player?.heroId ?? null,
                team: player?.team ?? null,
                presence: gridToWireArrays(row.presenceGrid as Grid),
                kills: gridToWireArrays(row.killsGrid as Grid),
                deaths: gridToWireArrays(row.deathsGrid as Grid),
              };
            }),
          }
        : undefined;

    return c.json({
      match,
      teams: [0, 1].map((team) => ({
        team,
        players: playersWithTalents.filter((p) => p.team === team),
      })),
      ...(timeline ? { timeline } : {}),
      ...(spatial ? { spatial } : {}),
      spatialCalibrated: calibrationRows.length > 0,
    });
  });
