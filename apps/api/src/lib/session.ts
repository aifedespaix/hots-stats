import { sign, verify } from "hono/jwt";
import { env } from "./env";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function createSessionToken(userId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return sign({ sub: userId, exp }, env.SESSION_SECRET);
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const payload = await verify(token, env.SESSION_SECRET, "HS256");
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = "hots_session";
export const SESSION_COOKIE_MAX_AGE = SESSION_TTL_SECONDS;
