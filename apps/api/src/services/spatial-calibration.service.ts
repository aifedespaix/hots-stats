import { type MapCalibration, type RawMapSample, db, mapCalibrations, rawMapSamples } from "@hots-stats/db";
import type { MapBounds } from "@hots-stats/shared-types";
import { eq } from "drizzle-orm";
import { ensureMapExists } from "../lib/ensure-map";

function toBounds(row: MapCalibration): MapBounds {
  return { minX: row.minX, maxX: row.maxX, minY: row.minY, maxY: row.maxY };
}

/** GET /spatial/calibrations -- the Daemon's full in-memory cache, refreshed once per run/batch. */
export async function getAllCalibrations(): Promise<Record<string, MapBounds>> {
  const rows = await db.select().from(mapCalibrations);
  return Object.fromEntries(rows.map((row) => [row.mapId, toBounds(row)]));
}

/**
 * POST /spatial/samples -- upserts (overwrites, doesn't accumulate) the raw
 * sample for a map the Daemon has no calibration for yet. `ensureMapExists`
 * guards against the Daemon reporting a brand new map slug before it's ever
 * been through POST /ingest (see lib/ensure-map.ts).
 */
export async function upsertRawSamples(mapId: string, points: { x: number; y: number }[]): Promise<void> {
  await ensureMapExists(mapId);
  await db
    .insert(rawMapSamples)
    .values({ mapId, rawPoints: points })
    .onConflictDoUpdate({
      target: rawMapSamples.mapId,
      set: { rawPoints: points, receivedAt: new Date() },
    });
}

// Arbitrary fixed "world" rectangle for synthetic example data -- not tied
// to any real HotS map's actual coordinate system (which the calibration
// tool has no way to know ahead of time anyway). Only exists so an admin
// can exercise the real /admin/spatial/samples/:mapId -> canvas ->
// /admin/spatial/calibrate pipeline end to end without a real replay.
const EXAMPLE_WORLD_BOUNDS = { minX: -200, maxX: 200, minY: -150, maxY: 150 };
const EXAMPLE_SCATTER_COUNT = 200;
const EXAMPLE_CLUSTER_COUNT = 50;
// Scattered points stay this far inset from the true bounds (real player
// positions rarely touch the literal map edge) -- also means "Auto-ajuster
// aux points" won't trivially reproduce EXAMPLE_WORLD_BOUNDS exactly,
// closer to what a real daemon sample would look like.
const EXAMPLE_INSET_RATIO = 0.15;

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Generates a synthetic raw sample for `mapId` and stores it exactly like a
 * real daemon upload would (via `upsertRawSamples`) -- lets an admin test
 * the calibration tool's canvas/projection/save flow against a real map
 * image without needing an actual replay. Not real spatial data: never
 * calibrate a map for production use from this, only to verify the tool
 * itself works.
 *
 * The point cloud is deliberately asymmetric: most points scattered evenly
 * across an inset rectangle, plus a denser cluster near the `(minX, minY)`
 * corner -- once calibrated, that cluster should visibly land at the
 * *bottom-left* of the canvas, which is a concrete, checkable confirmation
 * that the Y-axis inversion (`utils/mapProjection.ts`) is behaving as
 * intended, not just "some points appeared somewhere."
 */
export async function generateExampleSample(mapId: string): Promise<{ mapId: string; points: { x: number; y: number }[] }> {
  const { minX, maxX, minY, maxY } = EXAMPLE_WORLD_BOUNDS;
  const insetX = (maxX - minX) * EXAMPLE_INSET_RATIO;
  const insetY = (maxY - minY) * EXAMPLE_INSET_RATIO;

  const scattered = Array.from({ length: EXAMPLE_SCATTER_COUNT }, () => ({
    x: randomInRange(minX + insetX, maxX - insetX),
    y: randomInRange(minY + insetY, maxY - insetY),
  }));

  // The dense corner cluster stays inside the same inset rectangle's
  // bottom-left quarter, not right at the literal (minX, minY) corner --
  // still unambiguously "the bottom-left region" once rendered.
  const clustered = Array.from({ length: EXAMPLE_CLUSTER_COUNT }, () => ({
    x: randomInRange(minX + insetX, minX + insetX + (maxX - minX) / 4),
    y: randomInRange(minY + insetY, minY + insetY + (maxY - minY) / 4),
  }));

  const points = [...scattered, ...clustered];
  await upsertRawSamples(mapId, points);
  return { mapId, points };
}

/** GET /admin/spatial/pending-maps -- populates the calibration tool's map picker. */
export async function listPendingMapIds(): Promise<string[]> {
  const rows = await db.select({ mapId: rawMapSamples.mapId }).from(rawMapSamples);
  return rows.map((row) => row.mapId);
}

/** GET /admin/spatial/samples/:mapId */
export async function getPendingSample(mapId: string): Promise<RawMapSample | null> {
  const [row] = await db.select().from(rawMapSamples).where(eq(rawMapSamples.mapId, mapId)).limit(1);
  return row ?? null;
}

/**
 * POST /admin/spatial/calibrate -- saves (or updates) a map's world bounds
 * and clears its pending raw sample, atomically. Re-calibrating an
 * already-calibrated map (no pending sample left) is allowed: the delete is
 * a silent no-op in that case.
 */
export async function saveCalibration(mapId: string, bounds: MapBounds): Promise<void> {
  await ensureMapExists(mapId);
  await db.transaction(async (tx) => {
    await tx
      .insert(mapCalibrations)
      .values({ mapId, ...bounds })
      .onConflictDoUpdate({
        target: mapCalibrations.mapId,
        set: { ...bounds, updatedAt: new Date() },
      });
    await tx.delete(rawMapSamples).where(eq(rawMapSamples.mapId, mapId));
  });
}
