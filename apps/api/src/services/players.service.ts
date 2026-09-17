import { db, heroes, maps, matches, matchPlayers, userAccounts, users } from "@hots-stats/db";
import type { GameMode, PlayerEncounterStats, PlayerFriendshipStatus } from "@hots-stats/shared-types";
import { and, desc, eq, inArray, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { type Scope, scopeConditions } from "../lib/account-selection";
import { linkedBattletags } from "../lib/account-scope";
import { getFriendshipStatuses } from "./friendships.service";

export interface PlayerHeroBreakdown {
  heroId: string;
  heroName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
}

export interface PlayerMapBreakdown {
  mapId: string;
  mapName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winrate: number;
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
/** The scope's BattleTags, or a sentinel that matches nothing extra when global/empty. */
function selfTags(scope: Scope): string[] {
  return scope.mode === "personal" && scope.battletags.length > 0 ? scope.battletags : [""];
}

/**
 * Scope conditions for "one of my rows" plus one specific opponent row. The
 * opponent side also excludes the viewer's own BattleTags, so a linked smurf
 * can never be reported as a player the user met.
 */
function versusOther(scope: Scope, otherBattletag: string, column: AnyPgColumn): SQL[] {
  const self = scope.mode === "personal" && scope.battletags.length > 0 ? scope.battletags : [""];
  return scopeConditions(
    [eq(column, otherBattletag), notInArray(column, self)],
    scope,
    matchPlayers.battletag,
  );
}

function encounterBase(scope: Scope, mode?: GameMode[]) {
  const other = alias(matchPlayers, "other");

  // Excludes the whole scope from the "other" side: with a smurf linked, the
  // main account would otherwise "encounter" the smurf in every merged game.
  const conditions = [
    ...scopeConditions([], scope, matchPlayers.battletag),
    notInArray(other.battletag, selfTags(scope)),
  ];
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));

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

  // user_accounts rather than users.battletag: a BattleTag can be linked to
  // several site accounts (sharing), and a secondary account has no
  // users.battletag row of its own.
  const rows = await db
    .select({
      userId: userAccounts.userId,
      battletag: userAccounts.battletag,
      isPrimary: userAccounts.isPrimary,
    })
    .from(userAccounts)
    .where(inArray(userAccounts.battletag, battletags));

  const viewerTags = new Set((await linkedBattletags(userId)).map((tag) => tag.toLowerCase()));
  const ownerIds = [...new Set(rows.map((row) => row.userId))].filter((id) => id !== userId);
  const statuses = await getFriendshipStatuses(userId, ownerIds);

  const byBattletag = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byBattletag.get(row.battletag) ?? [];
    list.push(row);
    byBattletag.set(row.battletag, list);
  }

  for (const battletag of battletags) {
    const candidates = byBattletag.get(battletag) ?? [];
    const isSelf =
      viewerTags.has(battletag.toLowerCase()) || candidates.some((row) => row.userId === userId);
    if (candidates.length === 0) {
      links.set(battletag, {
        accountUserId: null,
        friendshipStatus: isSelf ? "self" : "none",
      });
      continue;
    }
    // Deterministic owner for the "add as friend" button: whoever holds the
    // tag as primary first, then whatever order the query returned.
    const owner = [...candidates].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0]!;
    links.set(battletag, {
      accountUserId: owner.userId,
      friendshipStatus: isSelf ? "self" : (statuses.get(owner.userId) ?? "none"),
    });
  }
  return links;
}

/**
 * Each battletag's own record across every match it appears in -- unlike
 * `encounterBase` (which is scoped to matches shared with `userId`), this
 * ignores the viewer entirely, so it's the same number regardless of who's
 * looking. Still respects the `mode` filter, same as everything else on
 * this page. K/D (not KDA) per the "Ratio K/D" column's own definition;
 * `null` when deathless, formatted as "Parfait" client-side.
 */
async function getGlobalPlayerStats(
  battletags: string[],
  mode?: GameMode[],
): Promise<Map<string, { gamesPlayed: number; winrate: number; kdRatio: number | null }>> {
  const result = new Map<string, { gamesPlayed: number; winrate: number; kdRatio: number | null }>();
  if (battletags.length === 0) return result;

  const conditions = [inArray(matchPlayers.battletag, battletags)];
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));

  const rows = await db
    .select({
      battletag: matchPlayers.battletag,
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
      kills: sql<number>`coalesce(sum(${matchPlayers.kills}), 0)::int`,
      deaths: sql<number>`coalesce(sum(${matchPlayers.deaths}), 0)::int`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(and(...conditions))
    .groupBy(matchPlayers.battletag);

  for (const row of rows) {
    result.set(row.battletag, {
      gamesPlayed: row.gamesPlayed,
      winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0,
      kdRatio: row.deaths > 0 ? row.kills / row.deaths : null,
    });
  }
  return result;
}

export async function listPlayerEncounters(
  userId: string,
  scope: Scope,
  sortBy: PlayerSortBy,
  sortDir: SortDir,
  mode?: GameMode[],
): Promise<PlayerEncounterStats[]> {
  const encounters = encounterBase(scope, mode);
  const order = sortDir === "asc" ? sql`${sortColumn[sortBy]} asc` : sql`${sortColumn[sortBy]} desc`;

  const rows = await db.with(encounters).select().from(encounters).orderBy(order);
  const battletags = rows.map((row) => row.battletag);
  const [links, globalStats] = await Promise.all([
    resolveAccountLinks(userId, battletags),
    getGlobalPlayerStats(battletags, mode),
  ]);

  return rows.map((row) => {
    const global = globalStats.get(row.battletag);
    return {
      battletag: row.battletag,
      gamesTogether: row.gamesTogether,
      gamesAsAlly: row.gamesAsAlly,
      gamesAsOpponent: row.gamesAsOpponent,
      winsAsAlly: row.winsAsAlly,
      winsAsOpponent: row.winsAsOpponent,
      accountUserId: links.get(row.battletag)?.accountUserId ?? null,
      friendshipStatus: links.get(row.battletag)?.friendshipStatus ?? "none",
      globalGamesPlayed: global?.gamesPlayed ?? 0,
      globalWinrate: global?.winrate ?? 0,
      globalKdRatio: global?.kdRatio ?? null,
    };
  });
}

export async function getPlayerEncounter(
  userId: string,
  scope: Scope,
  battletag: string,
  mode?: GameMode[],
): Promise<PlayerEncounterStats | null> {
  const other = alias(matchPlayers, "other");

  const conditions = versusOther(scope, battletag, other.battletag);
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));

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
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(other, and(eq(other.matchId, matchPlayers.matchId), ne(other.id, matchPlayers.id)))
    .where(and(...conditions));

  if (!row || row.gamesAsAlly + row.gamesAsOpponent === 0) return null;

  const [links, globalStats] = await Promise.all([
    resolveAccountLinks(userId, [battletag]),
    getGlobalPlayerStats([battletag], mode),
  ]);
  const link = links.get(battletag);
  const global = globalStats.get(battletag);

  return {
    battletag,
    gamesTogether: row.gamesAsAlly + row.gamesAsOpponent,
    gamesAsAlly: row.gamesAsAlly,
    gamesAsOpponent: row.gamesAsOpponent,
    winsAsAlly: row.winsAsAlly,
    winsAsOpponent: row.winsAsOpponent,
    accountUserId: link?.accountUserId ?? null,
    friendshipStatus: link?.friendshipStatus ?? "none",
    globalGamesPlayed: global?.gamesPlayed ?? 0,
    globalWinrate: global?.winrate ?? 0,
    globalKdRatio: global?.kdRatio ?? null,
  };
}

/**
 * Breakdown, per hero, of the connected user's games *against* `battletag` --
 * team must differ, otherwise shared-ally games would inflate the count and
 * misrepresent a matchup that never happened.
 */
export async function getPlayerHeroBreakdown(
  scope: Scope,
  battletag: string,
  mode?: GameMode[],
): Promise<PlayerHeroBreakdown[]> {
  const other = alias(matchPlayers, "other");

  const conditions = versusOther(scope, battletag, other.battletag);
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));

  const rows = await db
    .select({
      heroId: matchPlayers.heroId,
      heroName: heroes.name,
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
    })
    .from(matchPlayers)
    .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(
      other,
      and(
        eq(other.matchId, matchPlayers.matchId),
        ne(other.id, matchPlayers.id),
        ne(matchPlayers.team, other.team),
      ),
    )
    .where(and(...conditions))
    .groupBy(matchPlayers.heroId, heroes.name)
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({ ...row, losses: row.gamesPlayed - row.wins }));
}

/**
 * Breakdown, per hero, of what `battletag` themselves played *against* the
 * connected user -- their pool, their wins/losses, VS games only. `wins`
 * here means `battletag` won (i.e. `other.winner`), not the connected user.
 */
export async function getOpponentHeroBreakdown(
  scope: Scope,
  battletag: string,
  mode?: GameMode[],
): Promise<PlayerHeroBreakdown[]> {
  const other = alias(matchPlayers, "other");

  const conditions = versusOther(scope, battletag, other.battletag);
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));

  const rows = await db
    .select({
      heroId: other.heroId,
      heroName: heroes.name,
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${other.winner})::int`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(
      other,
      and(
        eq(other.matchId, matchPlayers.matchId),
        ne(other.id, matchPlayers.id),
        ne(matchPlayers.team, other.team),
      ),
    )
    .innerJoin(heroes, eq(heroes.id, other.heroId))
    .where(and(...conditions))
    .groupBy(other.heroId, heroes.name)
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({ ...row, losses: row.gamesPlayed - row.wins }));
}

/**
 * Win rate per map for the connected user's games *against* `battletag`
 * (VS only), worst first -- surfaces which maps are worth avoiding/forcing
 * against this specific opponent.
 */
export async function getPlayerMapBreakdown(
  scope: Scope,
  battletag: string,
  mode?: GameMode[],
): Promise<PlayerMapBreakdown[]> {
  const other = alias(matchPlayers, "other");

  const conditions = versusOther(scope, battletag, other.battletag);
  if (mode && mode.length > 0) conditions.push(inArray(matches.gameMode, mode));

  const rows = await db
    .select({
      mapId: matches.mapId,
      mapName: maps.name,
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(maps, eq(maps.id, matches.mapId))
    .innerJoin(
      other,
      and(
        eq(other.matchId, matchPlayers.matchId),
        ne(other.id, matchPlayers.id),
        ne(matchPlayers.team, other.team),
      ),
    )
    .where(and(...conditions))
    .groupBy(matches.mapId, maps.name)
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({
    ...row,
    losses: row.gamesPlayed - row.wins,
    winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0,
  }));
}
