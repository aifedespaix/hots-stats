import { z } from "zod";

export const mapBoundsSchema = z.object({
  minX: z.number(),
  maxX: z.number(),
  minY: z.number(),
  maxY: z.number(),
});
export type MapBounds = z.infer<typeof mapBoundsSchema>;

/**
 * GET /spatial/calibrations response body: mapId -> world bounds, with
 * `updatedAt` so the Daemon can detect a map that's new or was just
 * recalibrated since it last checked (see app.py's
 * `_sync_spatial_calibrations`).
 */
export const spatialCalibrationsResponseSchema = z.record(z.string(), mapBoundsSchema.extend({ updatedAt: z.string() }));
export type SpatialCalibrationsResponse = z.infer<typeof spatialCalibrationsResponseSchema>;

export const rawMapPointSchema = z.object({ x: z.number(), y: z.number() });
export type RawMapPoint = z.infer<typeof rawMapPointSchema>;

/**
 * POST /spatial/samples body -- the daemon's ~1000-point subsample of raw,
 * unnormalized positions for a map it has no calibration for yet (see
 * tasks/epic-10-analyse-spatiale.md). `max(2000)` is headroom above the
 * daemon's actual target, not a real limit the daemon is expected to hit.
 */
export const postSpatialSamplesInputSchema = z.object({
  mapId: z.string().min(1),
  points: z.array(rawMapPointSchema).min(1).max(2000),
});
export type PostSpatialSamplesInput = z.infer<typeof postSpatialSamplesInputSchema>;

/** POST /admin/spatial/calibrate body. */
export const postSpatialCalibrateInputSchema = mapBoundsSchema.extend({
  mapId: z.string().min(1),
});
export type PostSpatialCalibrateInput = z.infer<typeof postSpatialCalibrateInputSchema>;
