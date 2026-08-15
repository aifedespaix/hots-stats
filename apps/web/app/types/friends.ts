import type { HeroStatsScope, PlayerFriendshipStatus } from "@hots-stats/shared-types";
import type { HeroStats } from "./analytics";
import type { StatsSummary } from "./matches";

export interface FriendUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  battletag: string | null;
  publicHandle: string | null;
}

export interface FriendsListResponse {
  friends: FriendUser[];
}

export interface FriendRequestItem {
  id: string;
  user: FriendUser;
  createdAt: string;
}

export interface FriendRequestsResponse {
  incoming: FriendRequestItem[];
  outgoing: FriendRequestItem[];
}

export interface FriendSearchResult extends FriendUser {
  friendshipStatus: PlayerFriendshipStatus;
}

export interface FriendSearchResponse {
  results: FriendSearchResult[];
}

export interface FriendSummaryResponse {
  friend: FriendUser;
  summary: StatsSummary;
  heroes: HeroStats[];
  scope: HeroStatsScope;
}
