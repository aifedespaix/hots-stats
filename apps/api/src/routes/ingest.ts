import type { User } from "@hots-stats/db";
import { replayPayloadSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { authToken } from "../middleware/auth-token";
import { UnknownReferenceError, upsertReplay } from "../services/replay-upsert.service";

type Env = { Variables: { user: User } };

/**
 * POST /ingest — called by the Python daemon, authenticated via Personal
 * Access Token (Bearer), not the Google session cookie.
 */
export const ingestRoute = new Hono<Env>().use("*", authToken).post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (body === null) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = replayPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const user = c.get("user");

  try {
    const result = await upsertReplay(parsed.data, user.id);
    return c.json(result, result.upserted ? 201 : 200);
  } catch (err) {
    if (err instanceof UnknownReferenceError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
});
