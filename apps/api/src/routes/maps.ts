import type { User } from "@hots-stats/db";
import { heroStatsScopeSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import { z } from "zod";
import { gameModeListSchema } from "../lib/query";
import { authSession, requireUser } from "../middleware/auth-session";
import { getMapDetail, getMapHub } from "../services/maps.service";

type Env = { Variables: { user: User } };

// Cross-filter for the Talent Analyzer's Map select: when set, only maps
// actually played with this hero are returned. `scope` defaults to
// "personal" when omitted (unchanged behavior for the Maps Hub page, which
// never sends it) -- the Talent Analyzer's Map select passes it explicitly
// so it always matches the Hero select and the page's own scope toggle.
const listQuerySchema = z.object({
  mode: gameModeListSchema.optional(),
  heroId: z.string().min(1).optional(),
  scope: heroStatsScopeSchema.optional(),
});

/** Maps Hub (tile grid of every map) and per-map detail (meta heroes, the
 * connected user's own record, Team Impact, soak winrate). See the "Talents
 * & Terrain" design doc's Mission 2. */
export const mapsRoute = new Hono<Env>()
  .use("*", authSession, requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const maps = await getMapHub(user.id, parsed.data.mode, parsed.data.heroId, parsed.data.scope ?? "personal");
    return c.json({ maps });
  })
  .get("/:mapId", async (c) => {
    const user = c.get("user");
    const detail = await getMapDetail(user.id, c.req.param("mapId"));
    if (!detail) return c.json({ error: "Map not found" }, 404);
    return c.json(detail);
  });
