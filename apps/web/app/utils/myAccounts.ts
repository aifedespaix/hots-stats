import type { PlayerAccount } from "@hots-stats/shared-types";

/**
 * Every BattleTag owned by the viewer, lowercased for comparison. Falls back
 * to `authData.user.battletag` (the primary) for an older API response that
 * doesn't carry the `accounts` list yet.
 */
export function myBattletagSet(
  accounts: PlayerAccount[] | undefined,
  fallback: string | null,
): Set<string> {
  const set = new Set((accounts ?? []).map((account) => account.battletag.toLowerCase()));
  if (set.size === 0 && fallback) set.add(fallback.toLowerCase());
  return set;
}

/** True when `battletag` is one of the viewer's accounts. */
export function isMine(battletag: string | null | undefined, mine: Set<string>): boolean {
  return Boolean(battletag) && mine.has(battletag!.toLowerCase());
}
