import type { User } from "@hots-stats/db";
import { postSpatialCalibrateInputSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { authSession, requireUser } from "../middleware/auth-session";
import { requireAdmin } from "../middleware/require-admin";
import {
  generateExampleSample,
  getPendingSample,
  listCalibratedMaps,
  listPendingMapIds,
  saveCalibration,
} from "../services/spatial-calibration.service";

type Env = { Variables: { user?: User } };

/**
 * Admin-only spatial calibration tool endpoints, session-authenticated
 * (cookie, like the rest of the web-facing API) plus `requireAdmin`. See
 * apps/web/app/pages/admin/calibrate.vue.
 */
export const adminSpatialRoute = new Hono<Env>()
  .use("*", authSession, requireUser, requireAdmin)
  .get("/pending-maps", async (c) => c.json({ maps: await listPendingMapIds() }))
  .get("/calibrated-maps", async (c) => c.json({ maps: await listCalibratedMaps() }))
  .get("/samples/:mapId", async (c) => {
    const sample = await getPendingSample(c.req.param("mapId"));
    if (!sample) {
      return c.json({ error: "No pending sample for this map" }, 404);
    }
    return c.json({ mapId: sample.mapId, points: sample.rawPoints, receivedAt: sample.receivedAt.toISOString() });
  })
  // Testing convenience, not a real ingestion path: generates a synthetic
  // raw sample for `mapId` so the calibration tool can be exercised without
  // a real replay upload -- see `generateExampleSample`'s doc comment.
  .post("/samples/:mapId/example", async (c) => {
    const result = await generateExampleSample(c.req.param("mapId"));
    return c.json({ status: "ok", pointCount: result.points.length }, 202);
  })
  .post("/calibrate", async (c) => {
    const parsed = postSpatialCalibrateInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { mapId, ...bounds } = parsed.data;
    await saveCalibration(mapId, bounds);
    return c.json({ status: "ok" });
  });
