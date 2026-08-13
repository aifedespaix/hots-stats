import { db, heroes, maps, matchPlayers, matches, talentPicks } from "@hots-stats/db";
import {
  DRAFT_RANKED_MODES,
  TALENT_HABIT_MIN_PICK_RATE,
  TALENT_HABIT_MIN_PICKS,
  TALENT_HABIT_MIN_WINRATE_GAP,
  type MapWeaknessStats,
  type MatchupWeaknessStats,
  type UnderperformingTalentStats,
} from "@hots-stats/shared-types";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

/**
 * Personal weakness diagnostics for the connected user, always scoped to
 * their own ranked games (`DRAFT_RANKED_MODES`) -- mixing in Brawl/ARAM
 * would muddy "which map costs me games" or "which talent underperforms"
 * with modes that don't reflect competitive play. Unlike `talents.service`'s
 * personal/global toggle, there's no "global" variant here: a diagnostic
 * about *your* habits only makes sense scoped to *your* matches.
 */
function rankedModeCondition() {
  return inArray(matches.gameMode, [...DRAFT_RANKED_MODES]);
}

/** Win rate per map, worst first -- no minimum-games floor here (the full
 * list is meant to be browsable like the Heroes page); callers that need a
 * reliable "biggest leak" pick their own floor over the result. */
export async function getMapWeaknesses(userId: string): Promise<MapWeaknessStats[]> {
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
    .where(and(eq(matchPlayers.userId, userId), rankedModeCondition()))
    .groupBy(matches.mapId, maps.name);

  return rows
    .map((row) => ({ ...row, winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0 }))
    .sort((a, b) => a.winrate - b.winrate);
}

/**
 * Win rate per *enemy* hero faced, worst first -- a self-join on the
 * opposing team of the user's own matches (same match, different team; a
 * hero is never picked twice in one match, so this never double-counts a
 * single game against a given hero).
 */
export async function getMatchupWeaknesses(userId: string): Promise<MatchupWeaknessStats[]> {
  const other = alias(matchPlayers, "other");

  const rows = await db
    .select({
      heroId: other.heroId,
      heroName: heroes.name,
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(other, and(eq(other.matchId, matchPlayers.matchId), ne(other.team, matchPlayers.team)))
    .innerJoin(heroes, eq(heroes.id, other.heroId))
    .where(and(eq(matchPlayers.userId, userId), rankedModeCondition()))
    .groupBy(other.heroId, heroes.name);

  return rows
    .map((row) => ({ ...row, winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0 }))
    .sort((a, b) => a.winrate - b.winrate);
}

/**
 * Talents the user picks as their de facto default at a tier (>= floor
 * picks, dominant share of that tier's picks for that hero) despite
 * winning noticeably less often with them than with whatever else they
 * occasionally picked instead at the same tier/hero -- a habit worth
 * reconsidering, not a one-off bad game. The internal "vs other picks" gap
 * (rather than a simple "vs hero's overall win rate") avoids a dominant
 * pick diluting its own baseline: at 90% pick rate, "overall win rate on
 * this hero" is mostly *this talent's* results already.
 */
export async function getUnderperformingTalents(userId: string): Promise<UnderperformingTalentStats[]> {
  const [talentRows, heroRows] = await Promise.all([
    db
      .select({
        heroId: matchPlayers.heroId,
        heroName: heroes.name,
        tier: talentPicks.tier,
        talentId: talentPicks.talentId,
        talentName: talentPicks.talentName,
        picks: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
      })
      .from(talentPicks)
      .innerJoin(matchPlayers, eq(matchPlayers.id, talentPicks.matchPlayerId))
      .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.userId, userId), rankedModeCondition()))
      .groupBy(matchPlayers.heroId, heroes.name, talentPicks.tier, talentPicks.talentId, talentPicks.talentName),
    db
      .select({
        heroId: matchPlayers.heroId,
        gamesPlayed: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
      })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.userId, userId), rankedModeCondition()))
      .groupBy(matchPlayers.heroId),
  ]);

  const heroTotals = new Map(heroRows.map((row) => [row.heroId, row]));
  const tierTotals = new Map<string, number>();
  for (const row of talentRows) {
    const key = `${row.heroId}:${row.tier}`;
    tierTotals.set(key, (tierTotals.get(key) ?? 0) + row.picks);
  }

  const flagged: { stat: UnderperformingTalentStats; gapVsOtherPicks: number }[] = [];
  for (const row of talentRows) {
    if (row.picks < TALENT_HABIT_MIN_PICKS) continue;

    const tierTotal = tierTotals.get(`${row.heroId}:${row.tier}`) ?? 0;
    const pickRate = tierTotal > 0 ? row.picks / tierTotal : 0;
    if (pickRate < TALENT_HABIT_MIN_PICK_RATE) continue;

    const heroTotal = heroTotals.get(row.heroId);
    if (!heroTotal) continue;
    const otherGames = heroTotal.gamesPlayed - row.picks;
    if (otherGames <= 0) continue; // picked every single time -- nothing to contrast against

    const talentWinrate = row.wins / row.picks;
    const otherWinrate = (heroTotal.wins - row.wins) / otherGames;
    const gapVsOtherPicks = otherWinrate - talentWinrate;
    if (gapVsOtherPicks < TALENT_HABIT_MIN_WINRATE_GAP) continue;

    flagged.push({
      stat: {
        heroId: row.heroId,
        heroName: row.heroName,
        tier: row.tier as UnderperformingTalentStats["tier"],
        talentId: row.talentId,
        talentName: row.talentName,
        picks: row.picks,
        pickRate,
        talentWinrate,
        heroWinrate: heroTotal.gamesPlayed > 0 ? heroTotal.wins / heroTotal.gamesPlayed : 0,
      },
      gapVsOtherPicks,
    });
  }

  return flagged.sort((a, b) => b.gapVsOtherPicks - a.gapVsOtherPicks).map((f) => f.stat);
}
