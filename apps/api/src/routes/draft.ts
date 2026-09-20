import type { User } from "@hots-stats/db";
import { draftPreferenceInputSchema, draftSnapshotInputSchema, type DraftSnapshot } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Scope } from "../lib/account-selection";
import { waitForFirst } from "../lib/wait-for-first";
import { accountScope } from "../middleware/account-scope";
import { authSession, requireUser } from "../middleware/auth-session";
import { authToken } from "../middleware/auth-token";
import {
  getCurrentSnapshotForViewer,
  getPlayerDraftStats,
  getTeamThreats,
  ingestDraftSnapshot,
  searchBattletags,
  setDraftPseudoPreference,
  subscribeToDraftUpdates,
} from "../services/draft.service";

// Comma-joined battletags, same convention as `gameModeListSchema` -- one
// query param instead of a repeated one, and cheap to build client-side
// from the already-resolved slots of a team.
const teamThreatsQuerySchema = z.object({ battletags: z.string().min(1) });

const battletagSearchQuerySchema = z.object({ q: z.string().default("") });

type Env = { Variables: { user: User; scope: Scope } };

// How often a ping keeps the connection alive through idle-timeout proxies
// between pushes -- pushes themselves (see draft.service.ts's `publish`)
// aren't on this schedule at all, they go out the moment a snapshot lands.
const SSE_PING_INTERVAL_MS = 20_000;

// How long `GET /draft/poll` holds a request open waiting for the next
// snapshot before answering "nothing new" (the client immediately re-polls).
// Kept well under Cloudflare's 100s origin timeout -- see the route's comment.
const DRAFT_POLL_WAIT_MS = 25_000;

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
  // Long-poll twin of `/stream`, and what the web app actually uses (see
  // useDraftStream.ts). Cloudflare fronts this API, and its HTTP/3 (QUIC) edge
  // resets long-lived streaming responses -- Chrome reported
  // `net::ERR_QUIC_PROTOCOL_ERROR` on `/stream` after a 200 and EventSource
  // retried in a loop. A short request the origin *holds* open is fine: the
  // response is delivered the moment a snapshot is published (or after the
  // hold expires with nothing new), so it stays near-realtime.
  .get("/poll", authSession, requireUser, async (c) => {
    const user = c.get("user");
    const since = c.req.query("since") || null;

    const pushed = await waitForFirst<DraftSnapshot>(
      (deliver) => {
        const unsubscribe = subscribeToDraftUpdates(user.id, {
          send: async (snapshot) => deliver(snapshot),
        });
        // Read *after* subscribing: a snapshot published between "do we
        // already have something new?" and this point would otherwise be
        // missed until the hold expired. `waitForFirst` ignores the second
        // delivery, so resolving twice is harmless.
        void getCurrentSnapshotForViewer(user.id)
          .then((current) => {
            if (current && current.id !== since) deliver(current);
          })
          .catch(() => {});
        return unsubscribe;
      },
      DRAFT_POLL_WAIT_MS,
      c.req.raw.signal,
    );

    if (pushed) {
      return c.json({ snapshot: pushed, id: pushed.id }, 200, { "Cache-Control": "no-store" });
    }
    const current = await getCurrentSnapshotForViewer(user.id);
    return c.json({ snapshot: current, id: current?.id ?? null }, 200, { "Cache-Control": "no-store" });
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
  .get("/battletags/search", authSession, requireUser, async (c) => {
    const parsed = battletagSearchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const battletags = await searchBattletags(parsed.data.q);
    return c.json({ battletags });
  })
  .get("/players/:battletag", authSession, requireUser, accountScope, async (c) => {
    const user = c.get("user");
    const stats = await getPlayerDraftStats(user.id, c.get("scope"), c.req.param("battletag"));
    return c.json({ stats });
  })
  .get("/teams/threats", authSession, requireUser, accountScope, async (c) => {
    const user = c.get("user");
    const parsed = teamThreatsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const battletags = [
      ...new Set(
        parsed.data.battletags
          .split(",")
          .map((battletag) => battletag.trim())
          .filter(Boolean),
      ),
    ].slice(0, 5);
    const threats = await getTeamThreats(user.id, c.get("scope"), battletags);
    return c.json({ threats });
  });
