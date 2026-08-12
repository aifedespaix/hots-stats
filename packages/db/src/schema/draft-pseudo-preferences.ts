import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Remembers which full battletag a viewer picked for an ambiguous in-game
 * display name (OCR'd from the draft screen, so it never carries a `#tag`)
 * during the live-draft feature -- see apps/api/src/services/draft.service.ts.
 * Scoped per viewer since two different viewers can see the same bare pseudo
 * and mean two different battletags.
 */
export const draftPseudoPreferences = pgTable(
  "draft_pseudo_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    viewerUserId: uuid("viewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Lowercased in-game display name as OCR'd, e.g. "valla".
    pseudo: text("pseudo").notNull(),
    chosenBattletag: text("chosen_battletag").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    viewerPseudoUnique: uniqueIndex("draft_pseudo_preferences_viewer_pseudo_idx").on(
      table.viewerUserId,
      table.pseudo,
    ),
  }),
);

export type DraftPseudoPreference = typeof draftPseudoPreferences.$inferSelect;
export type NewDraftPseudoPreference = typeof draftPseudoPreferences.$inferInsert;
