import { type User, db, friendships, users } from "@hots-stats/db";
import { and, eq, ilike, ne, or, sql } from "drizzle-orm";

export interface FriendUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  battletag: string | null;
  publicHandle: string | null;
}

export type FriendshipStatus = "none" | "friends" | "pending_outgoing" | "pending_incoming";

function toFriendUser(user: User): FriendUser {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    battletag: user.battletag,
    publicHandle: user.publicHandle,
  };
}

async function findFriendshipRow(userId: string, otherUserId: string) {
  const [row] = await db
    .select()
    .from(friendships)
    .where(
      or(
        and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, otherUserId)),
        and(eq(friendships.requesterId, otherUserId), eq(friendships.addresseeId, userId)),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getFriendshipStatus(userId: string, otherUserId: string): Promise<FriendshipStatus> {
  const row = await findFriendshipRow(userId, otherUserId);
  if (!row) return "none";
  if (row.status === "accepted") return "friends";
  return row.requesterId === userId ? "pending_outgoing" : "pending_incoming";
}

/** Batch variant of `getFriendshipStatus`, used to enrich player/search lists without N+1 queries. */
export async function getFriendshipStatuses(
  userId: string,
  otherUserIds: string[],
): Promise<Map<string, FriendshipStatus>> {
  if (otherUserIds.length === 0) return new Map();

  const rows = await db
    .select()
    .from(friendships)
    .where(
      or(
        and(eq(friendships.requesterId, userId), sql`${friendships.addresseeId} = any(${otherUserIds})`),
        and(eq(friendships.addresseeId, userId), sql`${friendships.requesterId} = any(${otherUserIds})`),
      ),
    );

  const statuses = new Map<string, FriendshipStatus>();
  for (const row of rows) {
    const otherId = row.requesterId === userId ? row.addresseeId : row.requesterId;
    if (row.status === "accepted") {
      statuses.set(otherId, "friends");
    } else {
      statuses.set(otherId, row.requesterId === userId ? "pending_outgoing" : "pending_incoming");
    }
  }
  return statuses;
}

export type SendFriendRequestResult =
  | { outcome: "requested" }
  | { outcome: "friends"; mutual: true }
  | { outcome: "error"; message: string };

/** Sends a friend request; if the target already sent one to us, both become friends immediately. */
export async function sendFriendRequest(
  requesterId: string,
  addresseeId: string,
): Promise<SendFriendRequestResult> {
  if (requesterId === addresseeId) {
    return { outcome: "error", message: "Impossible de s'ajouter soi-même en ami" };
  }

  const existing = await findFriendshipRow(requesterId, addresseeId);

  if (existing?.status === "accepted") {
    return { outcome: "error", message: "Vous êtes déjà amis" };
  }

  if (existing?.status === "pending") {
    if (existing.requesterId === requesterId) {
      return { outcome: "error", message: "Demande déjà envoyée" };
    }
    // The other person already requested us — accept their request instead of creating a new one.
    await db.update(friendships).set({ status: "accepted", updatedAt: new Date() }).where(eq(friendships.id, existing.id));
    return { outcome: "friends", mutual: true };
  }

  await db.insert(friendships).values({ requesterId, addresseeId, status: "pending" });
  return { outcome: "requested" };
}

export async function respondToFriendRequest(
  userId: string,
  requestId: string,
  accept: boolean,
): Promise<boolean> {
  const [request] = await db
    .select()
    .from(friendships)
    .where(and(eq(friendships.id, requestId), eq(friendships.addresseeId, userId), eq(friendships.status, "pending")))
    .limit(1);

  if (!request) return false;

  if (accept) {
    await db.update(friendships).set({ status: "accepted", updatedAt: new Date() }).where(eq(friendships.id, requestId));
  } else {
    await db.delete(friendships).where(eq(friendships.id, requestId));
  }
  return true;
}

export async function cancelFriendRequest(userId: string, requestId: string): Promise<boolean> {
  const result = await db
    .delete(friendships)
    .where(and(eq(friendships.id, requestId), eq(friendships.requesterId, userId), eq(friendships.status, "pending")))
    .returning({ id: friendships.id });
  return result.length > 0;
}

export async function removeFriend(userId: string, friendUserId: string): Promise<boolean> {
  const result = await db
    .delete(friendships)
    .where(
      and(
        eq(friendships.status, "accepted"),
        or(
          and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, friendUserId)),
          and(eq(friendships.requesterId, friendUserId), eq(friendships.addresseeId, userId)),
        ),
      ),
    )
    .returning({ id: friendships.id });
  return result.length > 0;
}

export async function areFriends(userId: string, otherUserId: string): Promise<boolean> {
  const row = await findFriendshipRow(userId, otherUserId);
  return row?.status === "accepted";
}

export async function listFriends(userId: string): Promise<FriendUser[]> {
  const rows = await db
    .select({ friendship: friendships, user: users })
    .from(friendships)
    .innerJoin(
      users,
      or(
        and(eq(friendships.requesterId, userId), eq(users.id, friendships.addresseeId)),
        and(eq(friendships.addresseeId, userId), eq(users.id, friendships.requesterId)),
      ),
    )
    .where(eq(friendships.status, "accepted"))
    .orderBy(users.displayName);

  return rows.map((row) => toFriendUser(row.user));
}

export interface FriendRequest {
  id: string;
  user: FriendUser;
  createdAt: Date;
}

export async function listIncomingRequests(userId: string): Promise<FriendRequest[]> {
  const rows = await db
    .select({ id: friendships.id, createdAt: friendships.createdAt, user: users })
    .from(friendships)
    .innerJoin(users, eq(users.id, friendships.requesterId))
    .where(and(eq(friendships.addresseeId, userId), eq(friendships.status, "pending")))
    .orderBy(friendships.createdAt);

  return rows.map((row) => ({ id: row.id, createdAt: row.createdAt, user: toFriendUser(row.user) }));
}

export async function listOutgoingRequests(userId: string): Promise<FriendRequest[]> {
  const rows = await db
    .select({ id: friendships.id, createdAt: friendships.createdAt, user: users })
    .from(friendships)
    .innerJoin(users, eq(users.id, friendships.addresseeId))
    .where(and(eq(friendships.requesterId, userId), eq(friendships.status, "pending")))
    .orderBy(friendships.createdAt);

  return rows.map((row) => ({ id: row.id, createdAt: row.createdAt, user: toFriendUser(row.user) }));
}

export interface UserSearchResult extends FriendUser {
  friendshipStatus: FriendshipStatus;
}

/** Finds accounts by battletag, public handle or display name to add as friends. */
export async function searchUsers(query: string, excludeUserId: string): Promise<UserSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const pattern = `%${trimmed}%`;
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        ne(users.id, excludeUserId),
        or(ilike(users.battletag, pattern), ilike(users.publicHandle, pattern), ilike(users.displayName, pattern)),
      ),
    )
    .limit(10);

  const statuses = await getFriendshipStatuses(excludeUserId, rows.map((row) => row.id));

  return rows.map((row) => ({ ...toFriendUser(row), friendshipStatus: statuses.get(row.id) ?? "none" }));
}

export async function findUserByBattletag(battletag: string): Promise<FriendUser | null> {
  const [row] = await db.select().from(users).where(eq(users.battletag, battletag)).limit(1);
  return row ? toFriendUser(row) : null;
}

export async function findUserById(userId: string): Promise<FriendUser | null> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return row ? toFriendUser(row) : null;
}
