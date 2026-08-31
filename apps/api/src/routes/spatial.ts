import type { User } from "@hots-stats/db";
import { postSpatialSamplesInputSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { authToken } from "../middleware/auth-token";
import { getAllCalibrations, getDefaultLayerCalibrations, upsertRawSamples } from "../services/spatial-calibration.service";

type Env = { Variables: { user: User } };

/**
 * GET /spatial/calibrations, GET /spatial/calibrations/by-layer,
 * POST /spatial/samples -- called by the Python daemon, Bearer-PAT
 * authenticated like /ingest (not admin-gated, but never unauthenticated:
 * an open write endpoint would let anyone flood raw_map_samples). See
 * tasks/epic-10-analyse-spatiale.md.
 *
 * Two GET /calibrations* routes, not one: `/calibrations` is the legacy
 * flat shape every daemon build through PARSER_VERSION "1.12" already
 * expects; `/calibrations/by-layer` is the nested-per-layer shape a
 * PARSER_VERSION "1.13"+ daemon calls instead. See
 * `spatial-calibration.service.ts`'s `getDefaultLayerCalibrations` for why
 * the legacy route can never just be removed/changed again.
 */
export const spatialRoute = new Hono<Env>()
  .use("*", authToken)
  .get("/calibrations", async (c) => c.json(await getDefaultLayerCalibrations()))
  .get("/calibrations/by-layer", async (c) => c.json(await getAllCalibrations()))
  .post("/samples", async (c) => {
    const parsed = postSpatialSamplesInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    await upsertRawSamples(parsed.data.mapId, parsed.data.points);
    return c.json({ status: "ok" }, 202);
  });
