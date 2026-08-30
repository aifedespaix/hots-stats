import { integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { heroes } from "./heroes";
import { maps } from "./maps";

export const matchOutcomeEnum = pgEnum("match_outcome", ["win", "loss"]);

/**
 * Incremental rollup of `match_spatial_grids`, so a multi-match "Historique"
 * comparison (see tasks/epic-10-analyse-spatiale.md's "Slot" model) never
 * has to sum potentially hundreds of raw per-match grids at read time --
 * `spatial-aggregate.service.ts` reads a handful of these rows instead.
 * Updated by merge-add (never overwrite) inside the same transaction as
 * `upsertReplay`, for every hero in a match that got a spatial grid --
 * *and* merge-subtracted first when a match is re-ingested (a newer
 * `parserVersion` replacing an existing one), so re-syncing the same match
 * twice never double-counts it here (see `replay-upsert.service.ts`).
 *
 * Two separate tables (this one, per-player, and
 * `heroMapGlobalSpatialRollup` below) rather than one with a nullable
 * `battletag` column: Postgres treats every `NULL` as distinct for
 * uniqueness purposes, so a single `UNIQUE(mapId, heroId, battletag,
 * outcome)` index would not actually enforce "at most one global row" --
 * splitting into two tables sidesteps that without a partial-index upsert
 * (fragile to get right without a live Postgres to verify against, see
 * verification notes for this feature).
 */
export const heroMapPlayerSpatialRollup = pgTable(
  "hero_map_player_spatial_rollup",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mapId: text("map_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    heroId: text("hero_id")
      .notNull()
      .references(() => heroes.id, { onDelete: "cascade" }),
    layer: text("layer").notNull().default(""),
    // Not a FK to users.id: rolled up for *every* battletag seen, registered
    // account or not, same identity convention as match_players.battletag.
    battletag: text("battletag").notNull(),
    outcome: matchOutcomeEnum("outcome").notNull(),
    matchCount: integer("match_count").notNull().default(0),
    gridCols: integer("grid_cols").notNull(),
    gridRows: integer("grid_rows").notNull(),
    presenceGrid: jsonb("presence_grid").notNull().$type<Record<string, number>>(),
    killsGrid: jsonb("kills_grid").notNull().$type<Record<string, number>>(),
    deathsGrid: jsonb("deaths_grid").notNull().$type<Record<string, number>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueRow: uniqueIndex("hero_map_player_spatial_rollup_unique").on(
      table.mapId,
      table.heroId,
      table.layer,
      table.battletag,
      table.outcome,
    ),
  }),
);

export type HeroMapPlayerSpatialRollup = typeof heroMapPlayerSpatialRollup.$inferSelect;
export type NewHeroMapPlayerSpatialRollup = typeof heroMapPlayerSpatialRollup.$inferInsert;

/** Same shape as `heroMapPlayerSpatialRollup`, aggregated across every player -- the "moyenne globale" Slot. */
export const heroMapGlobalSpatialRollup = pgTable(
  "hero_map_global_spatial_rollup",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mapId: text("map_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    heroId: text("hero_id")
      .notNull()
      .references(() => heroes.id, { onDelete: "cascade" }),
    layer: text("layer").notNull().default(""),
    outcome: matchOutcomeEnum("outcome").notNull(),
    matchCount: integer("match_count").notNull().default(0),
    gridCols: integer("grid_cols").notNull(),
    gridRows: integer("grid_rows").notNull(),
    presenceGrid: jsonb("presence_grid").notNull().$type<Record<string, number>>(),
    killsGrid: jsonb("kills_grid").notNull().$type<Record<string, number>>(),
    deathsGrid: jsonb("deaths_grid").notNull().$type<Record<string, number>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueRow: uniqueIndex("hero_map_global_spatial_rollup_unique").on(
      table.mapId,
      table.heroId,
      table.layer,
      table.outcome,
    ),
  }),
);

export type HeroMapGlobalSpatialRollup = typeof heroMapGlobalSpatialRollup.$inferSelect;
export type NewHeroMapGlobalSpatialRollup = typeof heroMapGlobalSpatialRollup.$inferInsert;
