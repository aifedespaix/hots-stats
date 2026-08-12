import type { User } from "@hots-stats/db";
import { draftPreferenceInputSchema, draftSnapshotInputSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { authSession, requireUser } from "../middleware/auth-session";
import { authToken } from "../middleware/auth-token";
import {
  getCurrentSnapshotForViewer,
  getPlayerDraftStats,
  ingestDraftSnapshot,
  setDraftPseudoPreference,
  subscribeToDraftUpdates,
} from "../services/draft.service";

type Env = { Variables: { user: User } };

// How often a ping keeps the connection alive through idle-timeout proxies
// between pushes -- pushes themselves (see draft.service.ts's `publish`)
// aren't on this schedule at all, they go out the moment a snapshot lands.
const SSE_PING_INTERVAL_MS = 20_000;

/**
 * `/draft/*` -- the live-draft feature. `/snapshot` is daemon-facing
 * (Bearer token, same as `/ingest`); `/stream`, `/preference` and
 * `/players/:battletag` are web-facing (session cookie), same auth as every
 * other dashboard route.
 */
export const draftRoute = new Hono<Env>()
  .post("/snapshot", authToken, async (c) => {
    const parsed = draftSnapshotInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const user = c.get("user");
    await ingestDraftSnapshot(user.id, parsed.data);
    return c.json({ status: "ok" }, 202);
  })
  .get("/stream", authSession, requireUser, (c) => {
    const user = c.get("user");

    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });

      const unsubscribe = subscribeToDraftUpdates(user.id, {
        send: (snapshot) => stream.writeSSE({ event: "snapshot", data: JSON.stringify(snapshot) }),
      });

      try {
        const current = await getCurrentSnapshotForViewer(user.id);
        await stream.writeSSE({ event: "snapshot", data: JSON.stringify(current) });

        while (!aborted) {
          await stream.sleep(SSE_PING_INTERVAL_MS);
          if (aborted) break;
          await stream.writeSSE({ event: "ping", data: "" });
        }
      } finally {
        unsubscribe();
      }
    });
  })
  .post("/preference", authSession, requireUser, async (c) => {
    const parsed = draftPreferenceInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const user = c.get("user");
    await setDraftPseudoPreference(user.id, parsed.data.pseudo, parsed.data.battletag);
    return c.json({ status: "ok" });
  })
  .get("/players/:battletag", authSession, requireUser, async (c) => {
    const user = c.get("user");
    const stats = await getPlayerDraftStats(user.id, c.req.param("battletag"));
    return c.json({ stats });
  });
