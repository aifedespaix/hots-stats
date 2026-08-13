import type { User } from "@hots-stats/db";
import { daemonErrorReportInputSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { DefaultAdapter, ReplayValidationError, resolveAdapter } from "../adapters";
import type { ReplayAdapter } from "../adapters";
import { API_VERSION, MIN_PARSER_VERSION } from "../constants";
import { authToken } from "../middleware/auth-token";
import { recordDaemonError } from "../services/daemon-errors.service";
import { quarantineRawReplay } from "../services/quarantine.service";
import { upsertReplay } from "../services/replay-upsert.service";
import { getStatsSummary } from "../services/stats.service";

type Env = { Variables: { user: User } };

/** `m_baseBuild` is Blizzard's own replay header field name -- kept as-is at the top level of the payload rather than camelCased, so adapters can read it the same way regardless of what else changed in a given build's structure. */
function extractBaseBuild(body: Record<string, unknown>): number | null {
  const value = body.m_baseBuild;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * POST /ingest, GET /ingest/summary, GET /ingest/version — called by the
 * Python daemon, authenticated via Personal Access Token (Bearer), not the
 * session cookie (unlike every other route, which the web dashboard calls
 * with a cookie via `authSession`).
 */
export const ingestRoute = new Hono<Env>()
  .use("*", authToken)
  .get("/summary", async (c) => {
    // Lets the daemon's settings window show "games recorded" without a
    // browser session — same summary as the web dashboard's /stats/summary,
    // just reachable with the token the daemon already has.
    const user = c.get("user");
    return c.json(await getStatsSummary(user.id));
  })
  .get("/version", (c) => {
    // Checked by the daemon on every startup (see sync_state.py /
    // app.py's `_sync_api_version`) so *the API* -- not the daemon -- gets
    // to decide when previously-synced replays need reprocessing, and
    // shown as-is in the settings window (gui.py).
    //
    // `dataResetAt` is the same idea scoped to one account instead of every
    // daemon: null until this user ever hits "Réinitialiser mes données" in
    // Settings (see routes/auth.ts's POST /me/reset-data), after which the
    // daemon drops ALL of its local sync state (not just stale entries) so
    // every replay still on disk gets reparsed and re-uploaded from scratch.
    const user = c.get("user");
    return c.json({
      apiVersion: API_VERSION,
      minParserVersion: MIN_PARSER_VERSION,
      dataResetAt: user.dataResetAt ? user.dataResetAt.toISOString() : null,
    });
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const record = body as Record<string, unknown>;
    const hasBaseBuild = "m_baseBuild" in record;
    const baseBuild = extractBaseBuild(record);
    if (hasBaseBuild && baseBuild === null) {
      return c.json({ error: "m_baseBuild must be an integer" }, 400);
    }

    const user = c.get("user");

    // No `m_baseBuild` at all: a daemon version predating this feature --
    // always the default (and, until now, only) structure. A build number
    // *is* present goes through adapter resolution/quarantine below.
    let adapter: ReplayAdapter;
    if (baseBuild === null) {
      adapter = DefaultAdapter;
    } else {
      const resolved = await resolveAdapter(baseBuild);
      if (!resolved) {
        await quarantineRawReplay({ baseBuild, rawPayload: record, uploadedByUserId: user.id });
        return c.json({ quarantined: true, baseBuild }, 202);
      }
      adapter = resolved;
    }

    let parsed: ReturnType<ReplayAdapter["parse"]>;
    try {
      parsed = adapter.parse(record);
    } catch (err) {
      if (err instanceof ReplayValidationError) {
        return c.json({ error: err.zodError.flatten() }, 400);
      }
      throw err;
    }

    const result = await upsertReplay(parsed, user.id);
    return c.json(result, result.upserted ? 201 : 200);
  })
  .post("/errors", async (c) => {
    // Best-effort report of a *local* ingestion failure the daemon already
    // recorded in its own sync_state.db (see ingestion.py's `_report_error`)
    // -- unlike the rest of this route, a bad body here doesn't mean a bad
    // replay, so it's surfaced with the same 400 shape rather than silently
    // dropped, but the daemon itself never lets a failure here interrupt
    // the sync loop (see api_client.py's `post_ingest_error`).
    const parsed = daemonErrorReportInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const user = c.get("user");
    await recordDaemonError(user.id, parsed.data);
    return c.json({ status: "ok" }, 202);
  });
