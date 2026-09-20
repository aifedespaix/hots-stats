import type { User } from "@hots-stats/db";
import { Hono } from "hono";
import { authorizeInputSchema, sanitizeDeviceName, tokenExchangeInputSchema } from "../lib/daemon-auth";
import { createFixedWindowLimiter } from "../lib/rate-limit";
import { authSession, requireUser } from "../middleware/auth-session";
import {
  createAuthorizationCode,
  deleteStaleAuthorizationCodes,
  exchangeAuthorizationCode,
} from "../services/daemon-auth.service";

type Env = { Variables: { user?: User } };

const authorizeLimiter = createFixedWindowLimiter({ limit: 10, windowMs: 60_000 });
const exchangeLimiter = createFixedWindowLimiter({ limit: 20, windowMs: 300_000 });

export const daemonAuthRoute = new Hono<Env>()
  .post("/authorize", authSession, requireUser, async (c) => {
    const user = c.get("user")!;
    if (!authorizeLimiter.allow(user.id)) {
      return c.json({ error: "Too many authorization requests" }, 429);
    }

    const parsed = authorizeInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    await deleteStaleAuthorizationCodes();

    const created = await createAuthorizationCode(user.id, {
      redirectUri: parsed.data.redirectUri,
      state: parsed.data.state,
      codeChallenge: parsed.data.codeChallenge,
      deviceName: sanitizeDeviceName(parsed.data.deviceName),
    });

    return c.json(
      {
        code: created.code,
        expiresAt: created.expiresAt.toISOString(),
        redirectUrl: created.redirectUrl,
      },
      201,
    );
  })
  .post("/token", async (c) => {
    const clientKey = c.req.header("x-forwarded-for") ?? "local";
    if (!exchangeLimiter.allow(clientKey)) {
      return c.json({ error: "Too many requests" }, 429);
    }

    const parsed = tokenExchangeInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_grant" }, 400);
    }

    const exchanged = await exchangeAuthorizationCode(parsed.data.code, parsed.data.codeVerifier);
    if (!exchanged) {
      return c.json({ error: "invalid_grant" }, 400);
    }

    return c.json(
      {
        token: exchanged.token,
        tokenId: exchanged.tokenId,
        createdAt: exchanged.createdAt.toISOString(),
        tokenName: exchanged.tokenName,
      },
      201,
    );
  });
