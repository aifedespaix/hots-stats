import { sql } from "drizzle-orm";
import { db } from "@hots-stats/db";
import { Hono } from "hono";

export const healthRoute = new Hono()
  .get("/", (c) => c.json({ status: "ok" }))
  .get("/db", async (c) => {
    await db.execute(sql`select 1`);
    return c.json({ status: "ok", db: "reachable" });
  });
