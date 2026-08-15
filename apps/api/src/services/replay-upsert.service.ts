import { db, heroes, matchDeaths, matchLevelSnapshots, matchPlayers, matches, maps, talentPicks, users } from "@hots-stats/db";
import type { ReplayPayload } from "@hots-stats/shared-types";
import { eq, inArray, or } from "drizzle-orm";
import { computeGameFingerprint } from "../lib/game-fingerprint";

export type UpsertResult =
  | { upserted: true; matchId: string }
  | { upserted: false; reason: "stale_version"; matchId: string };

/**
 * Slug ("industrial-district") -> best-effort display name ("Industrial
 * District"), used to auto-create a placeholder row for a map/hero the
 * daemon reports that isn't in the DB yet (a new map/hero shipped in the
 * game before the seed list was updated). Good enough to be usable in the
 * UI immediately; can be corrected later with a real name/icon/role.
 */
function displayNameFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
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
 * Unknown map/hero slugs are auto-created with a best-effort display name
 * (derived from the slug) rather than rejected, so a new battleground or
 * hero the daemon already knows how to parse doesn't block every replay
 * that features it until someone manually updates the seed list. Heroes
 * created this way get a `null` role (unknown) — see schema/heroes.ts.
 */
export async function upsertReplay(payload: ReplayPayload, uploadedByUserId: string): Promise<UpsertResult> {
  const [map] = await db.select({ id: maps.id }).from(maps).where(eq(maps.id, payload.map)).limit(1);
  if (!map) {
    await db
      .insert(maps)
      .values({ id: payload.map, name: displayNameFromSlug(payload.map) })
      .onConflictDoNothing();
  }

  const heroIds = [...new Set(payload.players.map((p) => p.heroId))];
  const foundHeroes = await db.select({ id: heroes.id }).from(heroes).where(inArray(heroes.id, heroIds));
  const foundHeroIds = new Set(foundHeroes.map((h) => h.id));
  const missingHeroIds = heroIds.filter((id) => !foundHeroIds.has(id));
  if (missingHeroIds.length > 0) {
    await db
      .insert(heroes)
      .values(missingHeroIds.map((id) => ({ id, name: displayNameFromSlug(id), role: null })))
      .onConflictDoNothing();
  }

  const battletags = payload.players.map((p) => p.battletag);
  const linkedUsers = await db
    .select({ id: users.id, battletag: users.battletag })
    .from(users)
    .where(inArray(users.battletag, battletags));
  const userIdByBattletag = new Map(
    linkedUsers.filter((u): u is { id: string; battletag: string } => u.battletag !== null).map((u) => [u.battletag, u.id]),
  );

  // `replayHash` alone doesn't catch a duplicate: it's a hash of the raw
  // replay file's bytes, and each participant's game client writes its own
  // (non-byte-identical) copy of the same game's replay. `gameFingerprint`
  // is the actual game identity, stable across who uploaded it -- matched
  // in addition to `replayHash` so a resync of the exact same file (whose
  // recomputed fingerprint could in principle drift after a parser fix)
  // still finds its existing row too. See lib/game-fingerprint.ts.
  const gameFingerprint = computeGameFingerprint(payload);
  const [existing] = await db
    .select({ id: matches.id, parserVersion: matches.parserVersion })
    .from(matches)
    .where(or(eq(matches.replayHash, payload.replayHash), eq(matches.gameFingerprint, gameFingerprint)))
    .limit(1);

  if (existing && !isVersionGreater(payload.parserVersion, existing.parserVersion)) {
    return { upserted: false, reason: "stale_version", matchId: existing.id };
  }

  // Grouped by battletag up front so the per-player loop below can look each
  // player's slice up in O(1) instead of re-filtering the whole match's
  // timeline once per player.
  const deathsByBattletag = new Map<string, { atSeconds: number }[]>();
  for (const death of payload.timeline?.deaths ?? []) {
    const list = deathsByBattletag.get(death.battletag) ?? [];
    list.push({ atSeconds: death.atSeconds });
    deathsByBattletag.set(death.battletag, list);
  }
  const levelSnapshotsByBattletag = new Map<string, { atSeconds: number; level: number }[]>();
  for (const snapshot of payload.timeline?.levelSnapshots ?? []) {
    const list = levelSnapshotsByBattletag.get(snapshot.battletag) ?? [];
    list.push({ atSeconds: snapshot.atSeconds, level: snapshot.level });
    levelSnapshotsByBattletag.set(snapshot.battletag, list);
  }

  return db.transaction(async (tx) => {
    let matchId: string;

    if (existing) {
      matchId = existing.id;
      await tx
        .update(matches)
        .set({
          parserVersion: payload.parserVersion,
          gameFingerprint,
          mapId: payload.map,
          gameMode: payload.gameMode,
          region: payload.region,
          gameVersion: payload.gameVersion,
          playedAt: new Date(payload.playedAt),
          durationSeconds: payload.durationSeconds,
          updatedAt: new Date(),
        })
        .where(eq(matches.id, matchId));
      // Replacing match_players cascades the delete to talent_picks,
      // match_deaths and match_level_snapshots.
      await tx.delete(matchPlayers).where(eq(matchPlayers.matchId, matchId));
    } else {
      const [created] = await tx
        .insert(matches)
        .values({
          replayHash: payload.replayHash,
          gameFingerprint,
          parserVersion: payload.parserVersion,
          mapId: payload.map,
          gameMode: payload.gameMode,
          region: payload.region,
          gameVersion: payload.gameVersion,
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

      const deaths = deathsByBattletag.get(player.battletag) ?? [];
      if (deaths.length > 0) {
        await tx.insert(matchDeaths).values(
          deaths.map((death) => ({ matchPlayerId: createdPlayer.id, atSeconds: death.atSeconds })),
        );
      }

      const levelSnapshots = levelSnapshotsByBattletag.get(player.battletag) ?? [];
      if (levelSnapshots.length > 0) {
        await tx.insert(matchLevelSnapshots).values(
          levelSnapshots.map((snapshot) => ({
            matchPlayerId: createdPlayer.id,
            atSeconds: snapshot.atSeconds,
            level: snapshot.level,
          })),
        );
      }
    }

    return { upserted: true, matchId } as const;
  });
}
