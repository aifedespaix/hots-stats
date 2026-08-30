import { index, integer, jsonb, pgEnum, pgTable, real, text, uuid } from "drizzle-orm/pg-core";
import { matchPlayers } from "./match-players";

// See packages/shared-types/src/replay-payload.ts's `killTypeSchema` for why
// this is a 2-way split, not the "hero/minion/structure/environment" 4-way
// split originally envisioned in tasks/epic-10-analyse-spatiale.md.
export const killTypeEnum = pgEnum("kill_type", ["hero", "other"]);

export const matchDeaths = pgTable(
  "match_deaths",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchPlayerId: uuid("match_player_id")
      .notNull()
      .references(() => matchPlayers.id, { onDelete: "cascade" }),
    // Seconds since "gates open" (same reference point as matches.durationSeconds).
    atSeconds: integer("at_seconds").notNull(),
    // Normalized [0,1] position, null when the map has no spatial
    // calibration yet at ingestion time (see spatial-calibration.service.ts).
    x: real("x"),
    y: real("y"),
    // Which calibrated layer `x`/`y` are normalized against -- null for the
    // map's default/only level, or when the death has no position at all.
    // Same convention as match_spatial_grids.layer, but stored as the
    // real string-or-null here (no NOT NULL/DEFAULT sentinel needed --
    // this table has its own uuid PK, not a composite key on this column).
    layer: text("layer"),
    // Battletags credited with the kill (jsonb text array, not a native
    // Postgres array -- matches this schema's existing jsonb-over-array
    // convention, see raw_map_samples.rawPoints). Empty/null when killType
    // is "other" or unknown.
    killers: jsonb("killers").$type<string[]>(),
    killType: killTypeEnum("kill_type"),
  },
  (table) => ({
    matchPlayerIdIdx: index("match_deaths_match_player_id_idx").on(table.matchPlayerId),
  }),
);

export type MatchDeath = typeof matchDeaths.$inferSelect;
export type NewMatchDeath = typeof matchDeaths.$inferInsert;
