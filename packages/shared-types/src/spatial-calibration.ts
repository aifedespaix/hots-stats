import { z } from "zod";

export const mapBoundsSchema = z.object({
  minX: z.number(),
  maxX: z.number(),
  minY: z.number(),
  maxY: z.number(),
});
export type MapBounds = z.infer<typeof mapBoundsSchema>;

/**
 * GET /spatial/calibrations response body: mapId -> layer key -> world
 * bounds, with `updatedAt` so the Daemon can detect a layer that's new or
 * was just recalibrated since it last checked (see app.py's
 * `_sync_spatial_calibrations`). The layer key is `""` for a map's
 * default/only level (mirrored as `null` on the wire `ReplayPayload`'s
 * `spatial.presence[].layer` -- see `apps/api/src/lib/spatial-layer.ts`),
 * or any other string for a named additional level (e.g. `"bottom"` for
 * Haunted Mines' underground). A map with only its default level calibrated
 * has a single-entry inner record; nothing about this shape assumes any
 * particular map has more than one.
 */
export const spatialCalibrationsResponseSchema = z.record(
  z.string(),
  z.record(z.string(), mapBoundsSchema.extend({ updatedAt: z.string() })),
);
export type SpatialCalibrationsResponse = z.infer<typeof spatialCalibrationsResponseSchema>;

/**
 * `team`/`kind` are additive and optional so an older daemon build's plain
 * `{x, y}` payload (PARSER_VERSION <= "1.16") and any raw sample already
 * stored before this shape existed both still validate/render.
 * - `team`: 0/1, the owning hero's side -- lets the calibration tool color
 *   points by team instead of a single flat color.
 * - `kind`: `"spawn"` marks a hero's single earliest recorded position
 *   (lands during the pre-game staging phase, before `GatesOpen` --  see
 *   `_collect_calibration_samples` in parser.py), `"scatter"` the regular
 *   evenly-strided-across-the-match subsample. Exactly up to 10 `"spawn"`
 *   points per sample (one per hero), a strong two-straight-lines
 *   calibration anchor alongside the scatter cloud.
 */
export const rawMapPointSchema = z.object({
  x: z.number(),
  y: z.number(),
  team: z.union([z.literal(0), z.literal(1)]).nullable().optional(),
  kind: z.enum(["scatter", "spawn"]).optional(),
});
export type RawMapPoint = z.infer<typeof rawMapPointSchema>;

/**
 * POST /spatial/samples body -- the daemon's raw, unnormalized *hero*
 * position sample (see `_collect_calibration_samples` in parser.py) for a
 * map with at least one uncalibrated layer: an evenly-strided ~1000-point
 * subsample across the whole match, plus up to 10 pre-game "spawn" anchor
 * points (see `rawMapPointSchema` above). Deliberately layer-agnostic: the
 * raw cloud is undifferentiated, and an admin manually carves out each
 * layer's rectangle from it in the calibration tool.
 */
export const postSpatialSamplesInputSchema = z.object({
  mapId: z.string().min(1),
  points: z.array(rawMapPointSchema).min(1).max(2000),
});
export type PostSpatialSamplesInput = z.infer<typeof postSpatialSamplesInputSchema>;

/** POST /admin/spatial/calibrate body. `layer` defaults to `""` (the map's
 * default level) when omitted -- an admin adding a second level for an
 * already-calibrated map sends a non-empty `layer` alongside the same
 * `mapId`, which becomes a new row rather than overwriting the existing
 * default-level calibration (see spatial-calibration.service.ts's
 * `saveCalibration`). */
export const postSpatialCalibrateInputSchema = mapBoundsSchema.extend({
  mapId: z.string().min(1),
  layer: z.string().trim().default(""),
});
export type PostSpatialCalibrateInput = z.infer<typeof postSpatialCalibrateInputSchema>;
