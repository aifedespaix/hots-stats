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
  // Nullable: auto-created placeholder rows (unknown hero slug ingested
  // before the seed list knows its role) leave this unset rather than
  // guessing — see replay-upsert.service.ts's `ensureHero`.
  role: heroRoleEnum("role"),
  iconUrl: text("icon_url"),
});

export type Hero = typeof heroes.$inferSelect;
export type NewHero = typeof heroes.$inferInsert;
