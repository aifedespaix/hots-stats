import { jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { maps } from "./maps";

// World-bounds calibration for one map, used by the Daemon to normalize raw
// SUnitPositionsEvent coordinates into [0,1] before building the `spatial`
// payload block (see tasks/epic-10-analyse-spatiale.md Livrable 1). Set once
// per map by an admin via the /admin/spatial/calibrate tool.
export const mapCalibrations = pgTable("map_calibrations", {
  mapId: text("map_id")
    .primaryKey()
    .references(() => maps.id, { onDelete: "cascade" }),
  minX: real("min_x").notNull(),
  maxX: real("max_x").notNull(),
  minY: real("min_y").notNull(),
  maxY: real("max_y").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MapCalibration = typeof mapCalibrations.$inferSelect;
export type NewMapCalibration = typeof mapCalibrations.$inferInsert;

// Raw, unnormalized sample points the Daemon uploads for a map it has no
// calibration for yet -- overwritten (not accumulated) on every subsequent
// upload for the same map. Kept around even after the map is calibrated
// (see spatial-calibration.service.ts's saveCalibration) so the admin
// calibration tool always has *something* to render when re-opening an
// already-calibrated map to fix a mistake -- "pending" is decided by
// whether a `map_calibrations` row exists, not by whether this row exists.
export const rawMapSamples = pgTable("raw_map_samples", {
  mapId: text("map_id")
    .primaryKey()
    .references(() => maps.id, { onDelete: "cascade" }),
  rawPoints: jsonb("raw_points").notNull().$type<{ x: number; y: number }[]>(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RawMapSample = typeof rawMapSamples.$inferSelect;
export type NewRawMapSample = typeof rawMapSamples.$inferInsert;
