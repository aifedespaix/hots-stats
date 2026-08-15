import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { maps } from "./maps";
import { users } from "./users";

export const gameModeEnum = pgEnum("game_mode", [
  "QuickMatch",
  "UnrankedDraft",
  "HeroLeague",
  "TeamLeague",
  "StormLeague",
  "ARAM",
  "Brawl",
  "Custom",
]);

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Hash of the raw replay file's bytes, computed by the daemon. Cheap exact-
  // resync check, but NOT a reliable game identity: every participant's game
  // client writes its own (non-byte-identical) copy of the replay, so two
  // different players uploading the same game get two different hashes here.
  replayHash: text("replay_hash").notNull().unique(),
  // Content-based game identity (map + roster), stable across which
  // player's daemon uploaded it -- see apps/api/src/lib/game-fingerprint.ts.
  // This is the actual dedup key; `replayHash`'s uniqueness alone doesn't
  // prevent the same game being inserted twice under two different players'
  // hashes.
  gameFingerprint: text("game_fingerprint").notNull().unique(),
  parserVersion: text("parser_version").notNull(),
  mapId: text("map_id")
    .notNull()
    .references(() => maps.id),
  gameMode: gameModeEnum("game_mode").notNull(),
  region: text("region").notNull(),
  // "major.minor.revision.baseBuild" (e.g. "2.55.15.96477"). Nullable:
  // matches ingested before PARSER_VERSION 1.5 don't have it until resynced.
  gameVersion: text("game_version"),
  playedAt: timestamp("played_at", { withTimezone: true }).notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
