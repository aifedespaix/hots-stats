import { index, integer, pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
import { matches } from "./matches";

// See packages/shared-types/src/replay-payload.ts's `matchStructureEventSchema`.
export const structureTypeEnum = pgEnum("structure_type", ["fort", "keep", "wall", "core"]);

/**
 * One fort/keep/wall/core destruction for a match -- keyed by `matchId`
 * (not `matchPlayerId` like `match-deaths.ts`: a structure belongs to a
 * team, not an individual hero, so there's no single owning player row to
 * attach it to). An anchor point for the Pro Comparison View's
 * event-anchored heatmap slices (see
 * apps/web/app/composables/useHeatmapSync.ts). Best-effort/optional at
 * ingestion -- see `matchStructureEventSchema`'s own doc comment.
 */
export const matchStructureEvents = pgTable(
  "match_structure_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    // The owning team (the side that lost the structure), 0 or 1.
    team: integer("team").notNull(),
    // Seconds since "gates open" (same reference point as matches.durationSeconds).
    atSeconds: integer("at_seconds").notNull(),
    structureType: structureTypeEnum("structure_type").notNull(),
  },
  (table) => ({
    matchIdIdx: index("match_structure_events_match_id_idx").on(table.matchId),
  }),
);

export type MatchStructureEvent = typeof matchStructureEvents.$inferSelect;
export type NewMatchStructureEvent = typeof matchStructureEvents.$inferInsert;
