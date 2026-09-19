import { index, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * One measurable goal a viewer set for themselves (E2): a target value on a
 * known A4 driver metric (see apps/api/src/lib/driver-analysis.ts), a
 * direction, an optional hero/map scope, and an optional deadline. Progress is
 * never stored -- it is recomputed from the caller's matches (see
 * apps/api/src/lib/goal-progress.ts). `achievedAt` is the first time the API
 * observed the goal met.
 */
export const playerGoals = pgTable(
  "player_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    metricKey: text("metric_key").notNull(),
    targetValue: real("target_value").notNull(),
    // "atLeast" (target is a floor) | "atMost" (target is a ceiling), enforced
    // by goalInputSchema at the API boundary, same convention as
    // player_annotations.rating.
    direction: text("direction").notNull(),
    scopeHeroId: text("scope_hero_id"),
    scopeMapId: text("scope_map_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    achievedAt: timestamp("achieved_at", { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index("player_goals_user_id_idx").on(table.userId),
  }),
);

export type PlayerGoalRow = typeof playerGoals.$inferSelect;
export type NewPlayerGoalRow = typeof playerGoals.$inferInsert;
