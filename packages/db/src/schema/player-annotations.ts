import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * A viewer's private "FDP"/"PGM" flags and free-text note on a battletag
 * they've encountered in their matches -- surfaced wherever that battletag
 * shows up across the app (players list, live draft, match detail). Scoped
 * per viewer: two viewers can tag the same battletag differently.
 */
export const playerAnnotations = pgTable(
  "player_annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    viewerUserId: uuid("viewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    battletag: text("battletag").notNull(),
    isFdp: boolean("is_fdp").notNull().default(false),
    isPgm: boolean("is_pgm").notNull().default(false),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    viewerBattletagUnique: uniqueIndex("player_annotations_viewer_battletag_idx").on(
      table.viewerUserId,
      table.battletag,
    ),
  }),
);

export type PlayerAnnotationRow = typeof playerAnnotations.$inferSelect;
export type NewPlayerAnnotationRow = typeof playerAnnotations.$inferInsert;
