import type { User } from "@hots-stats/db";
import { postSpatialSamplesInputSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { authToken } from "../middleware/auth-token";
import { getAllCalibrations, upsertRawSamples } from "../services/spatial-calibration.service";

type Env = { Variables: { user: User } };

/**
 * GET /spatial/calibrations, POST /spatial/samples -- called by the Python
 * daemon, Bearer-PAT authenticated like /ingest (not admin-gated, but never
 * unauthenticated: an open write endpoint would let anyone flood
 * raw_map_samples). See tasks/epic-10-analyse-spatiale.md.
 */
export const spatialRoute = new Hono<Env>()
  .use("*", authToken)
  .get("/calibrations", async (c) => c.json(await getAllCalibrations()))
  .post("/samples", async (c) => {
    const parsed = postSpatialSamplesInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    await upsertRawSamples(parsed.data.mapId, parsed.data.points);
    return c.json({ status: "ok" }, 202);
  });
