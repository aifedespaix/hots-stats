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
