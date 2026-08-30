import { jsonb, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";
import { maps } from "./maps";

// World-bounds calibration for one map's one level, used by the Daemon to
// normalize raw SUnitPositionsEvent coordinates into [0,1] before building
// the `spatial` payload block (see tasks/epic-10-analyse-spatiale.md
// Livrable 1). Set once per (map, layer) by an admin via
// /admin/spatial/calibrate.
export const mapCalibrations = pgTable(
  "map_calibrations",
  {
    mapId: text("map_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    // "" = the map's single/default level -- what every row meant before
    // multi-level support existed, so existing rows keep working via this
    // column's default. A non-empty key (e.g. "bottom" for Haunted Mines'
    // underground) names an additional level. NOT NULL: Postgres can't
    // enforce uniqueness across a nullable composite-PK column, so the
    // wire/API's `string | null` becomes this sentinel string at the DB
    // boundary only -- see apps/api/src/lib/spatial-layer.ts.
    layer: text("layer").notNull().default(""),
    minX: real("min_x").notNull(),
    maxX: real("max_x").notNull(),
    minY: real("min_y").notNull(),
    maxY: real("max_y").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.mapId, table.layer] }),
  }),
);

export type MapCalibration = typeof mapCalibrations.$inferSelect;
export type NewMapCalibration = typeof mapCalibrations.$inferInsert;

// Raw, unnormalized *hero* sample points the Daemon uploads for a map with
// at least one uncalibrated layer -- overwritten (not accumulated) on every
// subsequent upload for the same map. Deliberately NOT layer-keyed: the
// cloud is undifferentiated, and an admin manually carves out each layer's
// rectangle from it in the calibration tool. Kept around even after every
// level is calibrated (see spatial-calibration.service.ts's
// saveCalibration) so the admin calibration tool always has *something* to
// render when re-opening an already-calibrated map to fix a mistake or add
// another level.
export const rawMapSamples = pgTable("raw_map_samples", {
  mapId: text("map_id")
    .primaryKey()
    .references(() => maps.id, { onDelete: "cascade" }),
  rawPoints: jsonb("raw_points").notNull().$type<{ x: number; y: number }[]>(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RawMapSample = typeof rawMapSamples.$inferSelect;
export type NewRawMapSample = typeof rawMapSamples.$inferInsert;
