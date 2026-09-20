import { describe, expect, test } from "bun:test";

// lib/env validates the whole process environment at import time; supply
// test-safe values before dynamically importing anything that reaches it.
process.env.DATABASE_URL ??= "postgres://localhost:5432/hots-stats-test";
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-chars";
process.env.CLAUDE_INTERNAL_SECRET ??= "test-internal-secret-at-least-32-chars";

describe("GET /health", () => {
  test("reports status and the web origin", async () => {
    const { healthRoute } = await import("./health");
    const { env } = await import("../lib/env");
    const res = await healthRoute.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", webOrigin: env.WEB_ORIGIN });
  });
});
