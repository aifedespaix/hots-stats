import { db, matchPlayers } from "@hots-stats/db";
import type { PlayerEncounterStats } from "@hots-stats/shared-types";
import { and, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export type PlayerSortBy = "battletag" | "gamesTogether" | "wins" | "losses";
export type SortDir = "asc" | "desc";

const sortColumn: Record<PlayerSortBy, ReturnType<typeof sql>> = {
  battletag: sql`battletag`,
  gamesTogether: sql`games_together`,
  wins: sql`wins`,
  losses: sql`losses`,
};

/**
 * Self-joins the connected user's rows against every other player row in the
 * same match to build cross-encounter stats (ally when same team, opponent otherwise).
 */
function encounterBase(userId: string) {
  const other = alias(matchPlayers, "other");

  return db.$with("encounters").as(
    db
      .select({
        battletag: other.battletag,
        gamesTogether: sql<number>`count(*)::int`.as("games_together"),
        gamesAsAlly: sql<number>`count(*) filter (where ${matchPlayers.team} = ${other.team})::int`.as(
          "games_as_ally",
        ),
        gamesAsOpponent:
          sql<number>`count(*) filter (where ${matchPlayers.team} != ${other.team})::int`.as(
            "games_as_opponent",
          ),
        winsAsAlly:
          sql<number>`count(*) filter (where ${matchPlayers.team} = ${other.team} and ${matchPlayers.winner})::int`.as(
            "wins_as_ally",
          ),
        winsAsOpponent:
          sql<number>`count(*) filter (where ${matchPlayers.team} != ${other.team} and ${matchPlayers.winner})::int`.as(
            "wins_as_opponent",
          ),
        wins:
          sql<number>`count(*) filter (where ${matchPlayers.winner})::int`.as("wins"),
        losses:
          sql<number>`count(*) filter (where not ${matchPlayers.winner})::int`.as("losses"),
      })
      .from(matchPlayers)
      .innerJoin(other, and(eq(other.matchId, matchPlayers.matchId), ne(other.id, matchPlayers.id)))
      .where(and(eq(matchPlayers.userId, userId), ne(other.battletag, matchPlayers.battletag)))
      .groupBy(other.battletag),
  );
}

export async function listPlayerEncounters(
  userId: string,
  sortBy: PlayerSortBy,
  sortDir: SortDir,
): Promise<PlayerEncounterStats[]> {
  const encounters = encounterBase(userId);
  const order = sortDir === "asc" ? sql`${sortColumn[sortBy]} asc` : sql`${sortColumn[sortBy]} desc`;

  const rows = await db.with(encounters).select().from(encounters).orderBy(order);

  return rows.map((row) => ({
    battletag: row.battletag,
    gamesTogether: row.gamesTogether,
    gamesAsAlly: row.gamesAsAlly,
    gamesAsOpponent: row.gamesAsOpponent,
    winsAsAlly: row.winsAsAlly,
    winsAsOpponent: row.winsAsOpponent,
  }));
}

export async function getPlayerEncounter(
  userId: string,
  battletag: string,
): Promise<PlayerEncounterStats | null> {
  const other = alias(matchPlayers, "other");

  const [row] = await db
    .select({
      gamesAsAlly: sql<number>`count(*) filter (where ${matchPlayers.team} = ${other.team})::int`,
      gamesAsOpponent: sql<number>`count(*) filter (where ${matchPlayers.team} != ${other.team})::int`,
      winsAsAlly:
        sql<number>`count(*) filter (where ${matchPlayers.team} = ${other.team} and ${matchPlayers.winner})::int`,
      winsAsOpponent:
        sql<number>`count(*) filter (where ${matchPlayers.team} != ${other.team} and ${matchPlayers.winner})::int`,
    })
    .from(matchPlayers)
    .innerJoin(other, and(eq(other.matchId, matchPlayers.matchId), ne(other.id, matchPlayers.id)))
    .where(and(eq(matchPlayers.userId, userId), eq(other.battletag, battletag)));

  if (!row || row.gamesAsAlly + row.gamesAsOpponent === 0) return null;

  return {
    battletag,
    gamesTogether: row.gamesAsAlly + row.gamesAsOpponent,
    gamesAsAlly: row.gamesAsAlly,
    gamesAsOpponent: row.gamesAsOpponent,
    winsAsAlly: row.winsAsAlly,
    winsAsOpponent: row.winsAsOpponent,
  };
}
