import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { matches } from "./matches";

/**
 * One mercenary-camp or map-objective capture for a match -- keyed by
 * matchId (not matchPlayerId like match-deaths.ts: an objective belongs to a
 * team, not to one hero). See
 * packages/shared-types/src/replay-payload.ts's matchObjectiveEventSchema and
 * daemon-python/src/parser.py's _extract_objective_events (PARSER_VERSION
 * 1.15).
 *
 * kind is text, not a pgEnum: unlike structure_type's closed set of four, the
 * objective vocabulary grows with each battleground, and the boundary that
 * matters is the ingest-time zod enum. team is null when the event carries no
 * unambiguous side.
 */
export const matchObjectiveEvents = pgTable(
  "match_objective_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    team: integer("team"),
    atSeconds: integer("at_seconds").notNull(),
    kind: text("kind").notNull(),
    detail: text("detail"),
  },
  (table) => ({
    matchIdIdx: index("match_objective_events_match_id_idx").on(table.matchId),
  }),
);

export type MatchObjectiveEventRow = typeof matchObjectiveEvents.$inferSelect;
export type NewMatchObjectiveEvent = typeof matchObjectiveEvents.$inferInsert;
