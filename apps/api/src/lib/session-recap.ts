import {
  PROGRESSION_MIN_MATCHES,
  clusterSessions,
  type SessionBaselineDelta,
  type SessionRecap,
  type SessionRecapResponse,
  type SessionRecapStats,
} from "@hots-stats/shared-types";
import { computePeriodStats, type TrendMatchInput } from "./trend-series";

/** One scope-resolved match feeding the E1 recap. Extends the A3 trend input so
 * the duration-weighted rate rule (A2) is reused rather than re-implemented. */
export interface SessionMatchInput extends TrendMatchInput {
  heroId: string;
  heroName: string;
  mapId: string;
  mapName: string;
}

/** Everything the pure module decides; the service stamps scope. */
export type SessionRecapCore = Omit<SessionRecapResponse, "scope">;

function chronological(matches: SessionMatchInput[]): SessionMatchInput[] {
  return [...matches].sort(
    (a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt) || a.matchId.localeCompare(b.matchId),
  );
}

/** Record + duration-weighted rates over one match set, built on the A3 period
 * rule so E1 and the trend cannot disagree. */
export function computeSessionStats(matches: SessionMatchInput[]): SessionRecapStats {
  const period = computePeriodStats(matches);
  const wins = matches.filter((entry) => entry.winner).length;
  return {
    gamesPlayed: period.gamesPlayed,
    wins,
    losses: period.gamesPlayed - wins,
    winrate: period.winrate,
    kda: period.kda,
    deathsPer10Min: period.deathsPer10Min,
    xpPerMinute: period.xpPerMinute,
  };
}

/**
 * Picks the session to recap. With no at, the most recent session. With an at,
 * the last session that started at or before it; a timestamp before the first
 * match has no session (null). sessions is oldest-first, as returned by the
 * shared clusterSessions, so the 90-minute boundary is the single C4 rule.
 */
export function selectSession(
  sessions: SessionMatchInput[][],
  at?: string,
): SessionMatchInput[] | null {
  if (sessions.length === 0) return null;
  if (!at) return sessions[sessions.length - 1] ?? null;
  const boundary = Date.parse(at);
  let chosen: SessionMatchInput[] | null = null;
  for (const session of sessions) {
    const first = session[0];
    if (!first || Date.parse(first.playedAt) > boundary) break;
    chosen = session;
  }
  return chosen;
}

function computeDelta(
  current: SessionRecapStats,
  baseline: SessionRecapStats,
): SessionBaselineDelta {
  return {
    winrate: current.winrate - baseline.winrate,
    kda: current.kda !== null && baseline.kda !== null ? current.kda - baseline.kda : null,
    deathsPer10Min: current.deathsPer10Min - baseline.deathsPer10Min,
    xpPerMinute: current.xpPerMinute - baseline.xpPerMinute,
  };
}

function buildSession(matches: SessionMatchInput[], stats: SessionRecapStats): SessionRecap {
  const first = matches[0]!;
  const last = matches[matches.length - 1]!;
  return {
    startedAt: first.playedAt,
    endedAt: last.playedAt,
    matches: matches.map((entry) => ({
      matchId: entry.matchId,
      playedAt: entry.playedAt,
      winner: entry.winner,
      durationSeconds: entry.durationSeconds,
      heroId: entry.heroId,
      heroName: entry.heroName,
      mapId: entry.mapId,
      mapName: entry.mapName,
      kills: entry.kills,
      deaths: entry.deaths,
      assists: entry.assists,
    })),
    stats,
  };
}

/**
 * Builds the E1 recap: the selected session, the player's baseline (every scope
 * match strictly before the session), and the deltas between them. The deltas
 * are exposed only when BOTH sides clear PROGRESSION_MIN_MATCHES, so the
 * endpoint never claims a trend on a thin sample.
 */
export function buildSessionRecap(matches: SessionMatchInput[], at?: string): SessionRecapCore {
  const ordered = chronological(matches);
  const session = selectSession(clusterSessions(ordered), at);
  if (!session) {
    return { session: null, baseline: null, baselineDelta: null, insufficientSample: true };
  }
  const sessionStart = Date.parse(session[0]!.playedAt);
  const baselineMatches = ordered.filter((entry) => Date.parse(entry.playedAt) < sessionStart);
  const stats = computeSessionStats(session);
  const baseline = computeSessionStats(baselineMatches);
  const sufficientSample =
    stats.gamesPlayed >= PROGRESSION_MIN_MATCHES &&
    baseline.gamesPlayed >= PROGRESSION_MIN_MATCHES;
  return {
    session: buildSession(session, stats),
    baseline,
    baselineDelta: sufficientSample ? computeDelta(stats, baseline) : null,
    insufficientSample: !sufficientSample,
  };
}
