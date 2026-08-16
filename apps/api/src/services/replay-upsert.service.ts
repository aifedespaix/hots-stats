import {
  db,
  heroes,
  matchDeaths,
  matchLevelSnapshots,
  matchPlayers,
  matchSpatialGrids,
  matches,
  talentPicks,
  users,
} from "@hots-stats/db";
import {
  type Grid,
  type MatchTimelineDeath,
  type ReplayPayload,
  cellIndexForPosition,
  gridFromWireArrays,
  incrementCell,
} from "@hots-stats/shared-types";
import { eq, inArray, or } from "drizzle-orm";
import { displayNameFromSlug, ensureMapExists } from "../lib/ensure-map";
import { computeGameFingerprint } from "../lib/game-fingerprint";
import { isVersionGreater } from "../lib/parser-version";
import { type SpatialGridContribution, applySpatialRollupDelta } from "./spatial-rollup.service";

export type UpsertResult =
  | { upserted: true; matchId: string }
  | { upserted: false; reason: "stale_version"; matchId: string };

/**
 * True if `matchId` already has at least one `match_spatial_grids` row.
 * Only queried on the "otherwise would be a stale-version no-op" path in
 * `upsertReplay` below, to detect the one case where a same-version
 * re-upload must still go through: a map getting calibrated *after* a
 * match was first ingested doesn't bump PARSER_VERSION at all (calibration
 * is server-side data, not parser code), so without this check a replay
 * re-parsed specifically to pick up that new calibration -- daemon-side via
 * `sync_state.invalidate_stale_for_maps`, or a manual web re-upload -- would
 * arrive with a non-null `payload.spatial` and still be silently dropped as
 * "stale_version", never actually backfilling the heatmap it was re-sent for.
 */
async function matchHasSpatialData(matchId: string): Promise<boolean> {
  const [row] = await db
    .select({ matchPlayerId: matchSpatialGrids.matchPlayerId })
    .from(matchSpatialGrids)
    .innerJoin(matchPlayers, eq(matchPlayers.id, matchSpatialGrids.matchPlayerId))
    .where(eq(matchPlayers.matchId, matchId))
    .limit(1);
  return row !== undefined;
}

interface PlayerSpatialContribution {
  battletag: string;
  heroId: string;
  gridCols: number;
  gridRows: number;
  presenceGrid: Grid;
  killsGrid: Grid;
  deathsGrid: Grid;
}

/**
 * Derives each hero's per-match spatial grids from `payload.spatial`
 * (presence, pre-gridded by the daemon) and `payload.timeline.deaths`
 * (kills/deaths, bucketed here from each death's normalized `x`/`y` --
 * the daemon only pre-grids presence, not individual deaths). `null` when
 * the replay has no `spatial` block at all (map wasn't calibrated at parse
 * time, or an older daemon build).
 */
function buildSpatialContributions(payload: ReplayPayload): PlayerSpatialContribution[] | null {
  if (!payload.spatial) return null;
  const { cols, rows } = payload.spatial.grid;

  const contributions = new Map<string, PlayerSpatialContribution>();
  for (const entry of payload.spatial.presence) {
    contributions.set(entry.battletag, {
      battletag: entry.battletag,
      heroId: entry.heroId,
      gridCols: cols,
      gridRows: rows,
      presenceGrid: gridFromWireArrays(entry.cellIndex, entry.secondsInCell),
      killsGrid: {},
      deathsGrid: {},
    });
  }

  for (const death of payload.timeline?.deaths ?? []) {
    if (death.x === undefined || death.y === undefined) continue;
    const cellIndex = cellIndexForPosition(death.x, death.y, cols, rows);

    const victim = contributions.get(death.battletag);
    if (victim) incrementCell(victim.deathsGrid, cellIndex);

    for (const killerBattletag of death.killers ?? []) {
      const killer = contributions.get(killerBattletag);
      if (killer) incrementCell(killer.killsGrid, cellIndex);
    }
  }

  return [...contributions.values()];
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
  await ensureMapExists(payload.map);

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
    .select({ id: matches.id, parserVersion: matches.parserVersion, mapId: matches.mapId })
    .from(matches)
    .where(or(eq(matches.replayHash, payload.replayHash), eq(matches.gameFingerprint, gameFingerprint)))
    .limit(1);

  if (existing && !isVersionGreater(payload.parserVersion, existing.parserVersion)) {
    const addsSpatialData = payload.spatial != null && !(await matchHasSpatialData(existing.id));
    if (!addsSpatialData) {
      return { upserted: false, reason: "stale_version", matchId: existing.id };
    }
  }

  // Grouped by battletag up front so the per-player loop below can look each
  // player's slice up in O(1) instead of re-filtering the whole match's
  // timeline once per player.
  const deathsByBattletag = new Map<string, MatchTimelineDeath[]>();
  for (const death of payload.timeline?.deaths ?? []) {
    const list = deathsByBattletag.get(death.battletag) ?? [];
    list.push(death);
    deathsByBattletag.set(death.battletag, list);
  }
  const levelSnapshotsByBattletag = new Map<string, { atSeconds: number; level: number }[]>();
  for (const snapshot of payload.timeline?.levelSnapshots ?? []) {
    const list = levelSnapshotsByBattletag.get(snapshot.battletag) ?? [];
    list.push({ atSeconds: snapshot.atSeconds, level: snapshot.level });
    levelSnapshotsByBattletag.set(snapshot.battletag, list);
  }

  const spatialContributionsByBattletag = new Map(
    (buildSpatialContributions(payload) ?? []).map((c) => [c.battletag, c]),
  );

  return db.transaction(async (tx) => {
    let matchId: string;

    if (existing) {
      matchId = existing.id;

      // Undo this match's *old* contribution to the spatial rollups before
      // its match_players (and, via cascade, match_spatial_grids) are
      // deleted below -- otherwise re-syncing the same match twice would
      // double-count it (see spatial-rollup.service.ts).
      const oldContributions = await tx
        .select({
          battletag: matchPlayers.battletag,
          heroId: matchPlayers.heroId,
          winner: matchPlayers.winner,
          gridCols: matchSpatialGrids.gridCols,
          gridRows: matchSpatialGrids.gridRows,
          presenceGrid: matchSpatialGrids.presenceGrid,
          killsGrid: matchSpatialGrids.killsGrid,
          deathsGrid: matchSpatialGrids.deathsGrid,
        })
        .from(matchPlayers)
        .leftJoin(matchSpatialGrids, eq(matchSpatialGrids.matchPlayerId, matchPlayers.id))
        .where(eq(matchPlayers.matchId, matchId));

      for (const old of oldContributions) {
        if (old.gridCols === null || old.gridRows === null || old.presenceGrid === null) continue;
        await applySpatialRollupDelta(
          tx,
          {
            mapId: existing.mapId,
            heroId: old.heroId,
            battletag: old.battletag,
            outcome: old.winner ? "win" : "loss",
            gridCols: old.gridCols,
            gridRows: old.gridRows,
            presenceGrid: old.presenceGrid,
            killsGrid: old.killsGrid ?? {},
            deathsGrid: old.deathsGrid ?? {},
          },
          -1,
        );
      }

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
      // match_deaths, match_level_snapshots and match_spatial_grids.
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
          deaths.map((death) => ({
            matchPlayerId: createdPlayer.id,
            atSeconds: death.atSeconds,
            x: death.x ?? null,
            y: death.y ?? null,
            killers: death.killers ?? null,
            killType: death.killType ?? null,
          })),
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

      const spatial = spatialContributionsByBattletag.get(player.battletag);
      if (spatial) {
        await tx.insert(matchSpatialGrids).values({
          matchPlayerId: createdPlayer.id,
          gridCols: spatial.gridCols,
          gridRows: spatial.gridRows,
          presenceGrid: spatial.presenceGrid,
          killsGrid: spatial.killsGrid,
          deathsGrid: spatial.deathsGrid,
        });

        const contribution: SpatialGridContribution = {
          mapId: payload.map,
          heroId: player.heroId,
          battletag: player.battletag,
          outcome: player.winner ? "win" : "loss",
          gridCols: spatial.gridCols,
          gridRows: spatial.gridRows,
          presenceGrid: spatial.presenceGrid,
          killsGrid: spatial.killsGrid,
          deathsGrid: spatial.deathsGrid,
        };
        await applySpatialRollupDelta(tx, contribution, 1);
      }
    }

    return { upserted: true, matchId } as const;
  });
}
