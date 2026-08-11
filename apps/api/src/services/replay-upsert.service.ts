import { db, heroes, matchPlayers, matches, maps, talentPicks, users } from "@hots-stats/db";
import type { ReplayPayload } from "@hots-stats/shared-types";
import { eq, inArray } from "drizzle-orm";

export type UpsertResult =
  | { upserted: true; matchId: string }
  | { upserted: false; reason: "stale_version"; matchId: string };

/** Thrown when the payload references a hero/map slug that doesn't exist yet. */
export class UnknownReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownReferenceError";
  }
}

/** Simple numeric-segment comparison, e.g. "1.10" > "1.9". */
function isVersionGreater(incoming: string, stored: string): boolean {
  const a = incoming.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = stored.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Upserts a replay payload from the daemon.
 *
 * Unknown map/hero slugs are rejected (UnknownReferenceError) rather than
 * created on the fly, to avoid orphaned placeholder rows — see Epic 3 brief.
 */
export async function upsertReplay(payload: ReplayPayload, uploadedByUserId: string): Promise<UpsertResult> {
  const [map] = await db.select({ id: maps.id }).from(maps).where(eq(maps.id, payload.map)).limit(1);
  if (!map) {
    throw new UnknownReferenceError(`Unknown map slug: ${payload.map}`);
  }

  const heroIds = [...new Set(payload.players.map((p) => p.heroId))];
  const foundHeroes = await db.select({ id: heroes.id }).from(heroes).where(inArray(heroes.id, heroIds));
  const foundHeroIds = new Set(foundHeroes.map((h) => h.id));
  const missingHeroId = heroIds.find((id) => !foundHeroIds.has(id));
  if (missingHeroId) {
    throw new UnknownReferenceError(`Unknown hero slug: ${missingHeroId}`);
  }

  const battletags = payload.players.map((p) => p.battletag);
  const linkedUsers = await db
    .select({ id: users.id, battletag: users.battletag })
    .from(users)
    .where(inArray(users.battletag, battletags));
  const userIdByBattletag = new Map(
    linkedUsers.filter((u): u is { id: string; battletag: string } => u.battletag !== null).map((u) => [u.battletag, u.id]),
  );

  const [existing] = await db
    .select({ id: matches.id, parserVersion: matches.parserVersion })
    .from(matches)
    .where(eq(matches.replayHash, payload.replayHash))
    .limit(1);

  if (existing && !isVersionGreater(payload.parserVersion, existing.parserVersion)) {
    return { upserted: false, reason: "stale_version", matchId: existing.id };
  }

  return db.transaction(async (tx) => {
    let matchId: string;

    if (existing) {
      matchId = existing.id;
      await tx
        .update(matches)
        .set({
          parserVersion: payload.parserVersion,
          mapId: payload.map,
          gameMode: payload.gameMode,
          region: payload.region,
          playedAt: new Date(payload.playedAt),
          durationSeconds: payload.durationSeconds,
          updatedAt: new Date(),
        })
        .where(eq(matches.id, matchId));
      // Replacing match_players cascades the delete to talent_picks.
      await tx.delete(matchPlayers).where(eq(matchPlayers.matchId, matchId));
    } else {
      const [created] = await tx
        .insert(matches)
        .values({
          replayHash: payload.replayHash,
          parserVersion: payload.parserVersion,
          mapId: payload.map,
          gameMode: payload.gameMode,
          region: payload.region,
          playedAt: new Date(payload.playedAt),
          durationSeconds: payload.durationSeconds,
          uploadedByUserId,
        })
        .returning({ id: matches.id });
      if (!created) {
        throw new Error("Failed to insert match");
      }
      matchId = created.id;
    }

    for (const player of payload.players) {
      const [createdPlayer] = await tx
        .insert(matchPlayers)
        .values({
          matchId,
          userId: userIdByBattletag.get(player.battletag) ?? null,
          battletag: player.battletag,
          heroId: player.heroId,
          team: player.team,
          winner: player.winner,
          kills: player.kills,
          deaths: player.deaths,
          assists: player.assists,
          heroDamage: player.heroDamage,
          siegeDamage: player.siegeDamage,
          healing: player.healing,
          selfHealing: player.selfHealing,
          damageTaken: player.damageTaken,
          experienceContribution: player.experienceContribution,
        })
        .returning({ id: matchPlayers.id });
      if (!createdPlayer) {
        throw new Error("Failed to insert match player");
      }

      if (player.talents.length > 0) {
        await tx.insert(talentPicks).values(
          player.talents.map((talent) => ({
            matchPlayerId: createdPlayer.id,
            tier: talent.tier,
            talentId: talent.talentId,
            talentName: talent.talentName,
          })),
        );
      }
    }

    return { upserted: true, matchId } as const;
  });
}
