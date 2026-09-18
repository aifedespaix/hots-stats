import { CONTEXT_SESSION_GAP_MINUTES } from "./stats";

/** Minimal shape needed to cluster matches into sessions: an identity and a
 * start timestamp. Both the API's C4 context breakdown and the web Dashboard
 * build on this module so the 90-minute rule cannot diverge. */
export interface SessionizableMatch {
  matchId: string;
  /** ISO datetime of the match start. */
  playedAt: string;
}

/** Where a match sits inside its session. */
export interface SessionPlacement {
  /** 1-based rank of the match within its session. */
  position: number;
  /** Number of matches in that session. */
  size: number;
}

function chronology<T extends SessionizableMatch>(a: T, b: T): number {
  return Date.parse(a.playedAt) - Date.parse(b.playedAt) || a.matchId.localeCompare(b.matchId);
}

/**
 * Clusters matches into sessions of consecutive starts at most `gapMinutes`
 * apart (89 minutes apart = one session, 91 = two). The gap between start
 * times is the only boundary derivable from the stored timestamps without
 * inventing an end time. Pure and deterministic: input order does not matter,
 * sessions are returned oldest-first and each session is chronologically
 * ordered, so the most recent session is the last element.
 */
export function clusterSessions<T extends SessionizableMatch>(
  matches: T[],
  gapMinutes: number = CONTEXT_SESSION_GAP_MINUTES,
): T[][] {
  const ordered = [...matches].sort(chronology);
  const gapMs = gapMinutes * 60_000;
  const sessions: T[][] = [];
  let current: T[] = [];
  let previousMs: number | null = null;
  for (const entry of ordered) {
    const ms = Date.parse(entry.playedAt);
    if (previousMs !== null && ms - previousMs > gapMs && current.length > 0) {
      sessions.push(current);
      current = [];
    }
    current.push(entry);
    previousMs = ms;
  }
  if (current.length > 0) sessions.push(current);
  return sessions;
}

/** matchId -> placement within its session. Built on `clusterSessions` so the
 * C4 context breakdown and the web Dashboard share one clustering rule. */
export function sessionizeMatches(
  matches: SessionizableMatch[],
  gapMinutes: number = CONTEXT_SESSION_GAP_MINUTES,
): Map<string, SessionPlacement> {
  const placements = new Map<string, SessionPlacement>();
  for (const session of clusterSessions(matches, gapMinutes)) {
    session.forEach((entry, index) => {
      placements.set(entry.matchId, { position: index + 1, size: session.length });
    });
  }
  return placements;
}
