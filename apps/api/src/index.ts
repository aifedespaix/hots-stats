import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { startQuarantineVerificationJob } from "./jobs/quarantine-verification.job";
import { env } from "./lib/env";
import { authRoute } from "./routes/auth";
import { compareRoute } from "./routes/compare";
import { draftRoute } from "./routes/draft";
import { friendsRoute } from "./routes/friends";
import { healthRoute } from "./routes/health";
import { heroesRoute } from "./routes/heroes";
import { ingestRoute } from "./routes/ingest";
import { internalRoute } from "./routes/internal";
import { mapsRoute } from "./routes/maps";
import { matchesRoute } from "./routes/matches";
import { playersRoute } from "./routes/players";
import { publicRoute } from "./routes/public";
import { statsRoute } from "./routes/stats";
import { talentAnalyzerRoute } from "./routes/talent-analyzer";
import { tokensRoute } from "./routes/tokens";
import { weaknessesRoute } from "./routes/weaknesses";

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
app.route("/heroes", heroesRoute);
app.route("/players", playersRoute);
app.route("/friends", friendsRoute);
app.route("/compare", compareRoute);
app.route("/draft", draftRoute);
app.route("/weaknesses", weaknessesRoute);
app.route("/maps", mapsRoute);
app.route("/talent-analyzer", talentAnalyzerRoute);
app.route("/public", publicRoute);
app.route("/_internal", internalRoute);

startQuarantineVerificationJob();

export default {
  port: env.PORT,
  fetch: app.fetch,
};
