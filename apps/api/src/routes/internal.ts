import { Hono } from "hono";
import { z } from "zod";
import { internalSecret } from "../middleware/internal-secret";
import { verifyQuarantinedBuild } from "../services/build-verification.service";
import { getDaemonErrorGroups, markDaemonErrorsResolved } from "../services/daemon-errors.service";
import { getQuarantineOverview, getQuarantineSamples } from "../services/quarantine.service";
import {
  getMatchDiagnostics,
  getParserVersionOverview,
  getUploadsDiagnostics,
  getZeroKdaDiagnostics,
} from "../services/uploads-diagnostics.service";

const paramsSchema = z.object({
  buildId: z.coerce.number().int().nonnegative(),
});

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(5).default(3),
});

const errorsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(200),
});

const zeroKdaQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const matchIdParamsSchema = z.object({
  matchId: z.string().uuid(),
});

const resolveErrorsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * `/_internal/*` -- tooling routes for triaging replay ingestion problems
 * without needing direct DB access: discovering/inspecting/verifying
 * quarantined builds (see `quarantine.service.ts` /
 * `build-verification.service.ts`), and reviewing daemon-reported ingestion
 * failures (see `daemon-errors.service.ts`). Not called by the daemon or
 * the web app. Guarded by `internalSecret`, mounted in `index.ts`.
 */
export const internalRoute = new Hono()
  .use("*", internalSecret)
  .get("/quarantine", async (c) => {
    const builds = await getQuarantineOverview();
    return c.json({ count: builds.length, builds });
  })
  .get("/quarantine/:buildId", async (c) => {
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
  })
  .post("/quarantine/:buildId/verify", async (c) => {
    // HTTP equivalent of `bun run check-build <buildId>` (see
    // `build-verification.service.ts`) -- lets a build get tested against
    // `DefaultAdapter` and, if compatible, verified + drained without shell
    // or DATABASE_URL access to the deployment.
    const params = paramsSchema.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: params.error.flatten() }, 400);
    }
    const result = await verifyQuarantinedBuild(params.data.buildId);
    if (result === null) {
      return c.json({ baseBuild: params.data.buildId, message: "No pending quarantined replays for this build." }, 404);
    }
    return c.json(result);
  })
  .get("/errors", async (c) => {
    const query = errorsQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: query.error.flatten() }, 400);
    }
    const groups = await getDaemonErrorGroups(query.data.limit);
    return c.json({ count: groups.length, groups });
  })
  .post("/errors/resolve", async (c) => {
    const body = resolveErrorsSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: body.error.flatten() }, 400);
    }
    const resolved = await markDaemonErrorsResolved(body.data.ids);
    return c.json({ resolved });
  })
  .get("/diagnostics/uploads", async (c) => {
    return c.json(await getUploadsDiagnostics());
  })
  .get("/diagnostics/zero-kda", async (c) => {
    const query = zeroKdaQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: query.error.flatten() }, 400);
    }
    return c.json(await getZeroKdaDiagnostics(query.data.limit));
  })
  .get("/diagnostics/parser-versions", async (c) => {
    return c.json({ versions: await getParserVersionOverview() });
  })
  .get("/diagnostics/match/:matchId", async (c) => {
    const params = matchIdParamsSchema.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: params.error.flatten() }, 400);
    }
    const result = await getMatchDiagnostics(params.data.matchId);
    if (!result) {
      return c.json({ error: "Match not found" }, 404);
    }
    return c.json(result);
  });
