import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Short-lived, single-use authorization codes for the daemon's loopback
 * browser handshake (see docs/superpowers/specs/2026-09-18-daemon-browser-auth-design.md).
 * Only the sha256 of the code is stored; the raw code is returned once.
 */
export const daemonAuthorizationCodes = pgTable("daemon_authorization_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
  redirectUri: text("redirect_uri").notNull(),
  deviceName: text("device_name"),
  tokenName: text("token_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export type DaemonAuthorizationCode = typeof daemonAuthorizationCodes.$inferSelect;
export type NewDaemonAuthorizationCode = typeof daemonAuthorizationCodes.$inferInsert;
