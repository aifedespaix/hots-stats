import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./lib/env";
import { authRoute } from "./routes/auth";
import { healthRoute } from "./routes/health";
import { ingestRoute } from "./routes/ingest";
import { matchesRoute } from "./routes/matches";
import { statsRoute } from "./routes/stats";
import { tokensRoute } from "./routes/tokens";

const app = new Hono();

app.use(logger());
app.use(
  "*",
  cors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  }),
);

app.route("/health", healthRoute);
app.route("/auth", authRoute);
app.route("/tokens", tokensRoute);
app.route("/ingest", ingestRoute);
app.route("/matches", matchesRoute);
app.route("/stats", statsRoute);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
