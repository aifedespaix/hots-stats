/**
 * Pure logic behind `useDraftStream`'s long-poll loop. Kept out of the
 * composable (which relies on Nuxt auto-imports and so cannot be imported by
 * the plain-vitest suite) for the same reason `draftAssist.ts` exists.
 */
import type { DraftSnapshot } from "@hots-stats/shared-types";

export const DRAFT_POLL_RETRY_BASE_DELAY_MS = 2_000;
export const DRAFT_POLL_RETRY_MAX_DELAY_MS = 30_000;

/** Exponential backoff for the `failures`-th consecutive failed poll (1-based), capped. */
export function draftPollRetryDelayMs(failures: number): number {
  return Math.min(
    DRAFT_POLL_RETRY_BASE_DELAY_MS * 2 ** (Math.max(1, failures) - 1),
    DRAFT_POLL_RETRY_MAX_DELAY_MS,
  );
}

/**
 * Whether a poll answer should replace the reactive snapshot. The server
 * replays the viewer's current snapshot on every hold that ends with nothing
 * new, and re-assigning an equivalent (freshly parsed) object would re-run
 * every watcher downstream for nothing -- so only a changed id (a new
 * capture) or an explicit "no draft" (`snapshot: null`) replaces it.
 */
export function shouldReplaceDraftSnapshot(
  previousId: string | null,
  next: { id: string | null; snapshot: DraftSnapshot | null },
): boolean {
  return next.id !== previousId || next.snapshot === null;
}
