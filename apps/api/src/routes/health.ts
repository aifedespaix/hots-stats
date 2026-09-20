import { sql } from "drizzle-orm";
import { db } from "@hots-stats/db";
import { Hono } from "hono";
import { env } from "../lib/env";

export const healthRoute = new Hono()
  // webOrigin is what lets the daemon -- which holds no token yet -- open the
  // right consent page for the browser handshake.
  .get("/", (c) => c.json({ status: "ok", webOrigin: env.WEB_ORIGIN }))
  .get("/db", async (c) => {
    await db.execute(sql`select 1`);
    return c.json({ status: "ok", db: "reachable" });
  });
