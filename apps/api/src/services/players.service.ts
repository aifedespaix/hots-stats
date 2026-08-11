import { db, heroes, matches, matchPlayers, users } from "@hots-stats/db";
import type { GameMode, PlayerEncounterStats, PlayerFriendshipStatus } from "@hots-stats/shared-types";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getFriendshipStatuses } from "./friendships.service";

export interface PlayerHeroBreakdown {
  heroId: string;
  heroName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
}

export type PlayerSortBy =
  | "battletag"
  | "gamesTogether"
  | "gamesAsAlly"
  | "gamesAsOpponent"
  | "wins"
  | "losses";
export type SortDir = "asc" | "desc";

const sortColumn: Record<PlayerSortBy, ReturnType<typeof sql>> = {
  battletag: sql`battletag`,
  gamesTogether: sql`games_together`,
  gamesAsAlly: sql`games_as_ally`,
  gamesAsOpponent: sql`games_as_opponent`,
  wins: sql`wins`,
  losses: sql`losses`,
};

/**
 * Self-joins the connected user's rows against every other player row in the
 * same match to build cross-encounter stats (ally when same team, opponent otherwise).
 */
function encounterBase(userId: string, mode?: GameMode) {
  const other = alias(matchPlayers, "other");

  const conditions = [eq(matchPlayers.userId, userId), ne(other.battletag, matchPlayers.battletag)];
  if (mode) conditions.push(eq(matches.gameMode, mode));

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
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .innerJoin(other, and(eq(other.matchId, matchPlayers.matchId), ne(other.id, matchPlayers.id)))
      .where(and(...conditions))
      .groupBy(other.battletag),
  );
}

/**
 * Resolves which of the given battletags belong to a registered account, and
 * (relative to `userId`) the friendship status with that account -- powers
 * the "add as friend" prompt on the players list/detail pages.
 */
async function resolveAccountLinks(
  userId: string,
  battletags: string[],
): Promise<Map<string, { accountUserId: string | null; friendshipStatus: PlayerFriendshipStatus }>> {
  const links = new Map<string, { accountUserId: string | null; friendshipStatus: PlayerFriendshipStatus }>();
  if (battletags.length === 0) return links;

  const accounts = await db
    .select({ id: users.id, battletag: users.battletag })
    .from(users)
    .where(inArray(users.battletag, battletags));

  const statuses = await getFriendshipStatuses(
    userId,
    accounts.filter((a) => a.id !== userId).map((a) => a.id),
  );

  for (const battletag of battletags) {
    const account = accounts.find((a) => a.battletag === battletag);
    if (!account) {
      links.set(battletag, { accountUserId: null, friendshipStatus: "none" });
      continue;
    }
    links.set(battletag, {
      accountUserId: account.id,
      friendshipStatus: account.id === userId ? "self" : (statuses.get(account.id) ?? "none"),
    });
  }
  return links;
}

export async function listPlayerEncounters(
  userId: string,
  sortBy: PlayerSortBy,
  sortDir: SortDir,
  mode?: GameMode,
): Promise<PlayerEncounterStats[]> {
  const encounters = encounterBase(userId, mode);
  const order = sortDir === "asc" ? sql`${sortColumn[sortBy]} asc` : sql`${sortColumn[sortBy]} desc`;

  const rows = await db.with(encounters).select().from(encounters).orderBy(order);
  const links = await resolveAccountLinks(
    userId,
    rows.map((row) => row.battletag),
  );

  return rows.map((row) => ({
    battletag: row.battletag,
    gamesTogether: row.gamesTogether,
    gamesAsAlly: row.gamesAsAlly,
    gamesAsOpponent: row.gamesAsOpponent,
    winsAsAlly: row.winsAsAlly,
    winsAsOpponent: row.winsAsOpponent,
    accountUserId: links.get(row.battletag)?.accountUserId ?? null,
    friendshipStatus: links.get(row.battletag)?.friendshipStatus ?? "none",
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

  const links = await resolveAccountLinks(userId, [battletag]);
  const link = links.get(battletag);

  return {
    battletag,
    gamesTogether: row.gamesAsAlly + row.gamesAsOpponent,
    gamesAsAlly: row.gamesAsAlly,
    gamesAsOpponent: row.gamesAsOpponent,
    winsAsAlly: row.winsAsAlly,
    winsAsOpponent: row.winsAsOpponent,
    accountUserId: link?.accountUserId ?? null,
    friendshipStatus: link?.friendshipStatus ?? "none",
  };
}

/** Breakdown, per hero, of the connected user's games shared with `battletag`. */
export async function getPlayerHeroBreakdown(
  userId: string,
  battletag: string,
): Promise<PlayerHeroBreakdown[]> {
  const other = alias(matchPlayers, "other");

  const rows = await db
    .select({
      heroId: matchPlayers.heroId,
      heroName: heroes.name,
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
    })
    .from(matchPlayers)
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .innerJoin(other, and(eq(other.matchId, matchPlayers.matchId), ne(other.id, matchPlayers.id)))
    .where(and(eq(matchPlayers.userId, userId), eq(other.battletag, battletag)))
    .groupBy(matchPlayers.heroId, heroes.name)
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({ ...row, losses: row.gamesPlayed - row.wins }));
}
