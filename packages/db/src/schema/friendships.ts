import { pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const friendshipStatusEnum = pgEnum("friendship_status", ["pending", "accepted"]);

// A single row represents a request from `requesterId` to `addresseeId`. Once
// accepted the row is kept (status flips to "accepted") rather than duplicated
// into a second row for the reverse direction — friendship is symmetric, so
// queries look up both directions explicitly.
export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: friendshipStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    requesterAddresseeUnique: uniqueIndex("friendships_requester_addressee_idx").on(
      table.requesterId,
      table.addresseeId,
    ),
  }),
);

export type Friendship = typeof friendships.$inferSelect;
export type NewFriendship = typeof friendships.$inferInsert;
