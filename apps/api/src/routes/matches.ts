import { type User, db, heroes, matchPlayers, matches, maps, talentPicks } from "@hots-stats/db";
import { and, asc, desc, eq, exists, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import { gameModeListSchema } from "../lib/query";
import { authSession, requireUser } from "../middleware/auth-session";

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

const filtersQuerySchema = z.object({
  mode: gameModeListSchema.optional(),
  heroId: z.string().optional(),
  mapId: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  opponentBattletag: z.string().optional(),
  allyBattletag: z.string().optional(),
});

const listQuerySchema = filtersQuerySchema.extend({
  sortBy: z.enum(["playedAt", "durationSeconds", "gameMode", "mapName", "heroName", "winner"]).default("playedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
});

/**
 * Builds the same set of match filter conditions used by `GET /matches`,
 * shared with `GET /matches/trend` (win-rate evolution chart) so both
 * always agree on what a given set of filters matches.
 */
function buildMatchConditions(userId: string, filters: z.infer<typeof filtersQuerySchema>) {
  const { mode, heroId, mapId, dateFrom, dateTo, opponentBattletag, allyBattletag } = filters;
  const opponent = alias(matchPlayers, "opponent");
  const ally = alias(matchPlayers, "ally");

  const conditions = [eq(matchPlayers.userId, userId)];
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));
  if (heroId) conditions.push(eq(matchPlayers.heroId, heroId));
  if (mapId) conditions.push(eq(matches.mapId, mapId));
  if (dateFrom) conditions.push(gte(matches.playedAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(matches.playedAt, new Date(dateTo)));
  if (opponentBattletag) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(opponent)
          .where(and(eq(opponent.matchId, matches.id), eq(opponent.battletag, opponentBattletag))),
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
  // Distinct heroes/maps the connected user has actually played, to populate filter dropdowns.
  .get("/filters", async (c) => {
    const user = c.get("user");

    const [heroRows, mapRows] = await Promise.all([
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
    ]);

    return c.json({ heroes: heroRows, maps: mapRows });
  })
  // Every match matching the given filters (no pagination), ordered
  // chronologically, for the "win rate evolution" chart on the matches
  // page -- it needs the full filtered history, not just one page of it.
  .get("/trend", async (c) => {
    const user = c.get("user");
    const parsed = filtersQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const where = buildMatchConditions(user.id, parsed.data);

    const rows = await db
      .select({ playedAt: matches.playedAt, winner: matchPlayers.winner })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(where)
      .orderBy(asc(matches.playedAt));

    return c.json({ points: rows });
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

    if (!players.some((p) => p.userId === user.id)) {
      return c.json({ error: "Match not found" }, 404);
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

    return c.json({
      match,
      teams: [0, 1].map((team) => ({
        team,
        players: playersWithTalents.filter((p) => p.team === team),
      })),
    });
  });
