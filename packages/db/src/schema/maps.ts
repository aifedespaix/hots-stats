import { pgTable, text } from "drizzle-orm/pg-core";

export const maps = pgTable("maps", {
  id: text("id").primaryKey(), // slug, e.g. "cursed-hollow"
  name: text("name").notNull(),
});

export type Map = typeof maps.$inferSelect;
export type NewMap = typeof maps.$inferInsert;
