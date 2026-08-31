import { type MapCalibration, type RawMapSample, db, mapCalibrations, maps, rawMapSamples } from "@hots-stats/db";
import type { MapBounds } from "@hots-stats/shared-types";
import { eq, isNull } from "drizzle-orm";
import { ensureMapExists } from "../lib/ensure-map";
import { DEFAULT_LAYER_KEY } from "../lib/spatial-layer";

function toBounds(row: MapCalibration): MapBounds {
  return { minX: row.minX, maxX: row.maxX, minY: row.minY, maxY: row.maxY };
}

/**
 * GET /spatial/calibrations -- the Daemon's full in-memory cache, refreshed
 * once per run/batch. mapId -> layer key -> bounds + `updatedAt`, so a
 * daemon can test a raw position against every calibrated layer of its
 * replay's map (see parser.py's `_normalized_position_samples_by_toon`) and
 * tell apart a layer it already knew about from one that's brand new or was
 * just recalibrated (see app.py's `_sync_spatial_calibrations`).
 */
export async function getAllCalibrations(): Promise<Record<string, Record<string, MapBounds & { updatedAt: string }>>> {
  const rows = await db.select().from(mapCalibrations);
  const result: Record<string, Record<string, MapBounds & { updatedAt: string }>> = {};
  for (const row of rows) {
    const byLayer = (result[row.mapId] ??= {});
    byLayer[row.layer] = { ...toBounds(row), updatedAt: row.updatedAt.toISOString() };
  }
  return result;
}

/**
 * GET /spatial/calibrations (legacy path) -- kept serving the pre-1.13
 * flat shape (`{mapId: MapBounds & {updatedAt}}`, default layer only)
 * forever, for any daemon build at PARSER_VERSION <= "1.12" still in the
 * field: an already-deployed daemon reads `calibration["minX"]` directly
 * and has no concept of a nested per-layer dict. A daemon on 1.13+ calls
 * `GET /spatial/calibrations/by-layer` instead (see `getAllCalibrations`
 * above). Never remove this without confirming no such daemon build
 * remains in circulation -- an earlier, unconditional shape change here
 * caused every calibrated map's replays to fail to ingest for every
 * already-deployed daemon (`KeyError` on `calibration["minX"]`), plus a
 * resync storm from its diffing logic reading every map as "changed".
 */
export async function getDefaultLayerCalibrations(): Promise<Record<string, MapBounds & { updatedAt: string }>> {
  const nested = await getAllCalibrations();
  const result: Record<string, MapBounds & { updatedAt: string }> = {};
  for (const [mapId, layers] of Object.entries(nested)) {
    const defaultLayer = layers[DEFAULT_LAYER_KEY];
    if (defaultLayer) result[mapId] = defaultLayer;
  }
  return result;
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
 * image without needing an actual replay. Not real spatial data, and not a
 * calibration aid: the whole point cloud lives inside an arbitrary fixed
 * rectangle (`EXAMPLE_WORLD_BOUNDS`) that has no relationship whatsoever to
 * any real map's actual coordinate system, so nothing in it -- including
 * the denser corner cluster below -- corresponds to any real in-game
 * location. Only ever use this to verify the tool itself renders and saves
 * correctly, never to calibrate a map for production use.
 *
 * The point cloud is deliberately asymmetric: most points scattered evenly
 * across an inset rectangle, plus a denser cluster near the `(minX, minY)`
 * corner -- once calibrated, that cluster should visibly land at the
 * *bottom-left* of the canvas, a concrete, checkable confirmation that the
 * Y-axis inversion in `utils/mapProjection.ts` is behaving as intended, not
 * just "some points appeared somewhere". That's its only purpose: it is
 * *not* a stand-in for a real hero spawn, and must not be presented as one.
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

/**
 * GET /admin/spatial/pending-maps -- populates the calibration tool's "à
 * calibrer" list: maps with a raw sample but *no* calibrated layer at all
 * yet. A map that already has one calibrated layer and needs another (e.g.
 * Haunted Mines' "bottom" level) is *not* pending -- it's picked from the
 * "calibrated maps" list instead and given a new `layer` value when saving
 * (see `saveCalibration` below). A map keeps its raw sample row after being
 * calibrated (see `saveCalibration`), so "pending" is decided by the
 * calibration join, not by row presence -- otherwise every already-
 * calibrated map would still show up here forever.
 */
export async function listPendingMapIds(): Promise<{ mapId: string; mapName: string; pointCount: number }[]> {
  const rows = await db
    .select({ mapId: rawMapSamples.mapId, mapName: maps.name, rawPoints: rawMapSamples.rawPoints })
    .from(rawMapSamples)
    .innerJoin(maps, eq(maps.id, rawMapSamples.mapId))
    .leftJoin(mapCalibrations, eq(mapCalibrations.mapId, rawMapSamples.mapId))
    .where(isNull(mapCalibrations.mapId));
  return rows.map((row) => ({ mapId: row.mapId, mapName: row.mapName, pointCount: row.rawPoints.length }));
}

/**
 * GET /admin/spatial/calibrated-maps -- lets the tool offer every
 * already-calibrated `(map, layer)` pair for editing, and is also how the
 * tool discovers which maps can have a *new* layer added (any map appearing
 * here at all is a candidate -- see calibrate.vue's "Ajouter un niveau").
 */
export async function listCalibratedMaps(): Promise<
  { mapId: string; mapName: string; layer: string; bounds: MapBounds; updatedAt: string }[]
> {
  const rows = await db
    .select({ mapId: mapCalibrations.mapId, mapName: maps.name, calibration: mapCalibrations })
    .from(mapCalibrations)
    .innerJoin(maps, eq(maps.id, mapCalibrations.mapId));
  return rows.map((row) => ({
    mapId: row.mapId,
    mapName: row.mapName,
    layer: row.calibration.layer,
    bounds: toBounds(row.calibration),
    updatedAt: row.calibration.updatedAt.toISOString(),
  }));
}

/** GET /admin/spatial/samples/:mapId */
export async function getPendingSample(mapId: string): Promise<RawMapSample | null> {
  const [row] = await db.select().from(rawMapSamples).where(eq(rawMapSamples.mapId, mapId)).limit(1);
  return row ?? null;
}

/**
 * POST /admin/spatial/calibrate -- saves (or updates) one `(mapId, layer)`
 * pair's world bounds. `layer` defaults to `DEFAULT_LAYER_KEY` ("") for a
 * map's default level; a non-empty value creates or updates an *additional*
 * level for the same map (the composite PK means this never overwrites a
 * different layer's row). Its raw sample row (if any) is deliberately left
 * in place so re-opening an already-calibrated map -- to fix a mistake, or
 * to add another level -- still has points to render against.
 */
export async function saveCalibration(mapId: string, layer: string, bounds: MapBounds): Promise<void> {
  await ensureMapExists(mapId);
  await db
    .insert(mapCalibrations)
    .values({ mapId, layer, ...bounds })
    .onConflictDoUpdate({
      target: [mapCalibrations.mapId, mapCalibrations.layer],
      set: { ...bounds, updatedAt: new Date() },
    });
}
