import { PROGRESSION_MIN_MATCHES, clusterSessions, type TrendPoint } from "@hots-stats/shared-types";

/** The most recent play session, as shown by the Dashboard's "Dernière
 * session" card. Derived from the chronological match series so it shares the
 * API's 90-minute clustering (see shared-types/sessions). */
export interface LastSessionSummary {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winrate: number;
  startedAt: string;
  endedAt: string;
  lastResult: "win" | "loss";
  /** True below PROGRESSION_MIN_MATCHES: the card shows the count, not a verdict. */
  insufficientSample: boolean;
}

/**
 * Summarises the last session of a match series (any input order). Returns
 * null when there is no match at all, so the caller can show an empty state
 * instead of a zeroed record.
 */
export function summarizeLastSession(points: TrendPoint[]): LastSessionSummary | null {
  const session = clusterSessions(points).at(-1);
  const first = session?.[0];
  const last = session?.[session.length - 1];
  if (!session || !first || !last) return null;
  const wins = session.filter((match) => match.winner).length;
  return {
    gamesPlayed: session.length,
    wins,
    losses: session.length - wins,
    winrate: wins / session.length,
    startedAt: first.playedAt,
    endedAt: last.playedAt,
    lastResult: last.winner ? "win" : "loss",
    insufficientSample: session.length < PROGRESSION_MIN_MATCHES,
  };
}
