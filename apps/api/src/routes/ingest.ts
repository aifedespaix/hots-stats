import type { User } from "@hots-stats/db";
import { daemonErrorReportInputSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { API_VERSION, MIN_PARSER_VERSION } from "../constants";
import { authToken } from "../middleware/auth-token";
import { recordDaemonError } from "../services/daemon-errors.service";
import { ingestReplayPayload } from "../services/replay-ingest.service";
import { getStatsSummary } from "../services/stats.service";

type Env = { Variables: { user: User } };

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
    const user = c.get("user");
    const result = await ingestReplayPayload(record, user.id);

    switch (result.status) {
      case "invalid":
        return c.json({ error: result.detail }, 400);
      case "quarantined":
        return c.json({ quarantined: true, baseBuild: result.baseBuild }, 202);
      case "processed":
        return c.json(
          result.upserted
            ? { upserted: true, matchId: result.matchId }
            : { upserted: false, matchId: result.matchId, reason: result.reason },
          result.upserted ? 201 : 200,
        );
    }
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
