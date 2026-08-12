import { Hono } from "hono";
import { z } from "zod";
import { internalSecret } from "../middleware/internal-secret";
import { getQuarantineSamples } from "../services/quarantine.service";

const paramsSchema = z.object({
  buildId: z.coerce.number().int().nonnegative(),
});

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(5).default(3),
});

/**
 * `/_internal/*` -- tooling routes for comparing raw replay JSON across
 * builds while writing/updating an adapter, not called by the daemon or
 * the web app. Guarded by `internalSecret`, mounted in `index.ts`.
 */
export const internalRoute = new Hono().use("*", internalSecret).get("/quarantine/:buildId", async (c) => {
  const params = paramsSchema.safeParse(c.req.param());
  if (!params.success) {
    return c.json({ error: params.error.flatten() }, 400);
  }
  const query = querySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: query.error.flatten() }, 400);
  }

  const samples = await getQuarantineSamples(params.data.buildId, query.data.limit);
  return c.json({ baseBuild: params.data.buildId, count: samples.length, samples });
});
