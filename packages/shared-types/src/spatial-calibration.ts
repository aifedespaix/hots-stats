import { z } from "zod";

export const mapBoundsSchema = z.object({
  minX: z.number(),
  maxX: z.number(),
  minY: z.number(),
  maxY: z.number(),
});
export type MapBounds = z.infer<typeof mapBoundsSchema>;

/** GET /spatial/calibrations response body: mapId -> world bounds. */
export const spatialCalibrationsResponseSchema = z.record(z.string(), mapBoundsSchema);
export type SpatialCalibrationsResponse = z.infer<typeof spatialCalibrationsResponseSchema>;

export const rawMapPointSchema = z.object({ x: z.number(), y: z.number() });
export type RawMapPoint = z.infer<typeof rawMapPointSchema>;

/**
 * A raw sample point as stored/displayed by the admin calibration tool --
 * `kind: "spawn"` only ever appears on the synthetic example generator's
 * dense corner cluster (see `generateExampleSample`), never on a real
 * daemon-uploaded point, and tells `CalibrationCanvas.vue` to render it as
 * a distinct calibration landmark instead of a plain scatter point.
 */
export interface StoredMapPoint extends RawMapPoint {
  kind?: "spawn";
}

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
