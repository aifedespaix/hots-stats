import type { User } from "@hots-stats/db";
import { goalInputSchema, goalUpdateSchema } from "@hots-stats/shared-types";
import { Hono } from "hono";
import type { Scope } from "../lib/account-selection";
import { isKnownDriverMetricKey } from "../lib/driver-analysis";
import { accountScope } from "../middleware/account-scope";
import { authSession, requireUser } from "../middleware/auth-session";
import { createGoal, deleteGoal, listGoals, suggestGoals, updateGoal } from "../services/goals.service";

type Env = { Variables: { user: User; scope: Scope } };

/**
 * `/goals/*` -- E2 measurable goals, session-cookie auth (web only). A goal
 * belongs to the caller (userId) and its progress is measured over the
 * caller's own accounts (accountScope + scopeConditions inside the service),
 * never another user's matches.
 */
export const goalsRoute = new Hono<Env>()
  .use("*", authSession, requireUser, accountScope)
  .get("/", async (c) => {
    const user = c.get("user");
    return c.json(await listGoals(c.get("scope"), user.id));
  })
  // Defines no goal: returns the pre-configured suggestions for the last 30
  // days, which the page uses to pre-fill the form.
  .get("/suggestions", async (c) => c.json(await suggestGoals(c.get("scope"))))
  .post("/", async (c) => {
    const parsed = goalInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    // AC1: only the A4 driver catalog is a valid metric key.
    if (!isKnownDriverMetricKey(parsed.data.metricKey)) {
      return c.json({ error: "Métrique inconnue." }, 400);
    }
    const user = c.get("user");
    return c.json({ goal: await createGoal(c.get("scope"), user.id, parsed.data) }, 201);
  })
  .patch("/:id", async (c) => {
    const parsed = goalUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    if (parsed.data.metricKey !== undefined && !isKnownDriverMetricKey(parsed.data.metricKey)) {
      return c.json({ error: "Métrique inconnue." }, 400);
    }
    const user = c.get("user");
    const goal = await updateGoal(c.get("scope"), user.id, c.req.param("id"), parsed.data);
    if (!goal) return c.json({ error: "Objectif introuvable" }, 404);
    return c.json({ goal });
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const deleted = await deleteGoal(user.id, c.req.param("id"));
    if (!deleted) return c.json({ error: "Objectif introuvable" }, 404);
    return c.json({ status: "ok" });
  });
