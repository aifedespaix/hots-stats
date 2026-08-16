import {
  type Transaction,
  heroMapGlobalSpatialRollup,
  heroMapPlayerSpatialRollup,
} from "@hots-stats/db";
import { type Grid, mergeGrid } from "@hots-stats/shared-types";
import { and, eq } from "drizzle-orm";

export interface SpatialGridContribution {
  mapId: string;
  heroId: string;
  battletag: string;
  outcome: "win" | "loss";
  gridCols: number;
  gridRows: number;
  presenceGrid: Grid;
  killsGrid: Grid;
  deathsGrid: Grid;
}

/**
 * Merge-adds (`sign: 1`) or merge-subtracts (`sign: -1`) one match's
 * contribution into both the per-player and the global spatial rollups (see
 * `packages/db/src/schema/hero-map-spatial-rollup.ts` and
 * tasks/epic-10-analyse-spatiale.md section 5). Called once per hero that
 * has a spatial grid in a match, from inside `upsertReplay`'s transaction --
 * with `sign: -1` first for a re-ingested match's *old* contribution (before
 * it's deleted), then `sign: 1` for the new one, so re-syncing a match never
 * double-counts it in the rollup.
 */
export async function applySpatialRollupDelta(
  tx: Transaction,
  contribution: SpatialGridContribution,
  sign: 1 | -1,
): Promise<void> {
  await Promise.all([applyPlayerRollupDelta(tx, contribution, sign), applyGlobalRollupDelta(tx, contribution, sign)]);
}

async function applyPlayerRollupDelta(tx: Transaction, c: SpatialGridContribution, sign: 1 | -1): Promise<void> {
  const [existing] = await tx
    .select()
    .from(heroMapPlayerSpatialRollup)
    .where(
      and(
        eq(heroMapPlayerSpatialRollup.mapId, c.mapId),
        eq(heroMapPlayerSpatialRollup.heroId, c.heroId),
        eq(heroMapPlayerSpatialRollup.battletag, c.battletag),
        eq(heroMapPlayerSpatialRollup.outcome, c.outcome),
      ),
    )
    .limit(1);

  if (!existing) {
    if (sign < 0) return; // Nothing to subtract from -- shouldn't happen, but never go negative.
    await tx.insert(heroMapPlayerSpatialRollup).values({
      mapId: c.mapId,
      heroId: c.heroId,
      battletag: c.battletag,
      outcome: c.outcome,
      matchCount: 1,
      gridCols: c.gridCols,
      gridRows: c.gridRows,
      presenceGrid: c.presenceGrid,
      killsGrid: c.killsGrid,
      deathsGrid: c.deathsGrid,
    });
    return;
  }

  if (existing.gridCols !== c.gridCols || existing.gridRows !== c.gridRows) {
    // A grid resolution change (spatial.schemaVersion bump) -- skip rather
    // than merge incompatible resolutions together. Requires a backfill job
    // to rebuild this rollup from match_spatial_grids once that happens;
    // see epic-10 section 5.
    return;
  }

  const matchCount = existing.matchCount + sign;
  if (matchCount <= 0) {
    await tx.delete(heroMapPlayerSpatialRollup).where(eq(heroMapPlayerSpatialRollup.id, existing.id));
    return;
  }

  await tx
    .update(heroMapPlayerSpatialRollup)
    .set({
      matchCount,
      presenceGrid: mergeGrid(existing.presenceGrid, c.presenceGrid, sign),
      killsGrid: mergeGrid(existing.killsGrid, c.killsGrid, sign),
      deathsGrid: mergeGrid(existing.deathsGrid, c.deathsGrid, sign),
      updatedAt: new Date(),
    })
    .where(eq(heroMapPlayerSpatialRollup.id, existing.id));
}

async function applyGlobalRollupDelta(tx: Transaction, c: SpatialGridContribution, sign: 1 | -1): Promise<void> {
  const [existing] = await tx
    .select()
    .from(heroMapGlobalSpatialRollup)
    .where(
      and(
        eq(heroMapGlobalSpatialRollup.mapId, c.mapId),
        eq(heroMapGlobalSpatialRollup.heroId, c.heroId),
        eq(heroMapGlobalSpatialRollup.outcome, c.outcome),
      ),
    )
    .limit(1);

  if (!existing) {
    if (sign < 0) return;
    await tx.insert(heroMapGlobalSpatialRollup).values({
      mapId: c.mapId,
      heroId: c.heroId,
      outcome: c.outcome,
      matchCount: 1,
      gridCols: c.gridCols,
      gridRows: c.gridRows,
      presenceGrid: c.presenceGrid,
      killsGrid: c.killsGrid,
      deathsGrid: c.deathsGrid,
    });
    return;
  }

  if (existing.gridCols !== c.gridCols || existing.gridRows !== c.gridRows) {
    return;
  }

  const matchCount = existing.matchCount + sign;
  if (matchCount <= 0) {
    await tx.delete(heroMapGlobalSpatialRollup).where(eq(heroMapGlobalSpatialRollup.id, existing.id));
    return;
  }

  await tx
    .update(heroMapGlobalSpatialRollup)
    .set({
      matchCount,
      presenceGrid: mergeGrid(existing.presenceGrid, c.presenceGrid, sign),
      killsGrid: mergeGrid(existing.killsGrid, c.killsGrid, sign),
      deathsGrid: mergeGrid(existing.deathsGrid, c.deathsGrid, sign),
      updatedAt: new Date(),
    })
    .where(eq(heroMapGlobalSpatialRollup.id, existing.id));
}
