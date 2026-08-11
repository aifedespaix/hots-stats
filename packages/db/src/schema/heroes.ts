import { pgEnum, pgTable, text } from "drizzle-orm/pg-core";

export const heroRoleEnum = pgEnum("hero_role", [
  "Tank",
  "Bruiser",
  "RangedAssassin",
  "MeleeAssassin",
  "Healer",
  "Support",
]);

export const heroes = pgTable("heroes", {
  id: text("id").primaryKey(), // slug, e.g. "li-ming"
  name: text("name").notNull(),
  role: heroRoleEnum("role").notNull(),
  iconUrl: text("icon_url"),
});

export type Hero = typeof heroes.$inferSelect;
export type NewHero = typeof heroes.$inferInsert;
