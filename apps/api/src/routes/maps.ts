import type { User } from "@hots-stats/db";
import { Hono } from "hono";
import { gameModeListSchema } from "../lib/query";
import { authSession, requireUser } from "../middleware/auth-session";
import { getMapDetail, getMapHub } from "../services/maps.service";

type Env = { Variables: { user: User } };

/** Maps Hub (tile grid of every map) and per-map detail (meta heroes, the
 * connected user's own record, Team Impact, soak winrate). See the "Talents
 * & Terrain" design doc's Mission 2. */
export const mapsRoute = new Hono<Env>()
  .use("*", authSession, requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const parsed = gameModeListSchema.optional().safeParse(c.req.query("mode"));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const maps = await getMapHub(user.id, parsed.data);
    return c.json({ maps });
  })
  .get("/:mapId", async (c) => {
    const user = c.get("user");
    const detail = await getMapDetail(user.id, c.req.param("mapId"));
    if (!detail) return c.json({ error: "Map not found" }, 404);
    return c.json(detail);
  });
