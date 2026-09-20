import {
  PROGRESSION_MIN_MATCHES,
  clusterSessions,
  type SessionBaselineDelta,
  type SessionDeltaNoise,
  type SessionRecap,
  type SessionRecapResponse,
  type SessionRecapStats,
  type SessionSummary,
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

/** Confidence level for the session delta band: 1.96 standard errors is a 95%
 * two-sided interval, the same level as the Wilson bounds used elsewhere, so
 * "surprising" means the same thing across the app. */
const SESSION_DELTA_Z = 1.96;

type DeltaMetric = "winrate" | "kda" | "deathsPer10Min" | "xpPerMinute";

/** One match's own value for a delta metric, so the band can be estimated from
 * the spread of single matches instead of the aggregate (which hides it). Null
 * when the metric is undefined for that match -- no death for KDA, no duration
 * for a rate -- and those matches are then left out of the estimate. */
function perMatchMetric(entry: SessionMatchInput, metric: DeltaMetric): number | null {
  switch (metric) {
    case "winrate":
      return entry.winner ? 1 : 0;
    case "kda":
      return entry.deaths > 0 ? (entry.kills + entry.assists) / entry.deaths : null;
    case "deathsPer10Min":
      return entry.durationSeconds > 0 ? entry.deaths / (entry.durationSeconds / 600) : null;
    case "xpPerMinute":
      return entry.durationSeconds > 0
        ? entry.experienceContribution / (entry.durationSeconds / 60)
        : null;
  }
}

/** Sample standard deviation (n-1), or null below two values: one match says
 * nothing about spread, and returning 0 would fake total certainty. */
function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return Math.sqrt(squares / (values.length - 1));
}

/** Bernoulli spread with Laplace smoothing, so a baseline that won (or lost)
 * every game keeps a non-zero band instead of marking every session a real
 * change against a certainty it never had. */
function proportionSd(wins: number, games: number): number {
  const p = (wins + 1) / (games + 2);
  return Math.sqrt(p * (1 - p));
}

/**
 * 95% half-width of the gap chance alone would produce between a session and its
 * baseline. The null is "the session is just n more draws from the player's usual
 * process", so the spread comes from the baseline's own matches: using the
 * session's own spread would be circular (it is the thing being tested) and
 * undefined for a one-game session. The two-sample standard error
 * `sd * sqrt(1/nSession + 1/nBaseline)` shrinks as either side grows, so the band
 * is widest exactly where the least is known. Null when either side has too few
 * usable matches to say anything.
 *
 * The KDA band reads the per-match ratio's spread, an approximation of the
 * ratio-of-sums delta: it is a "is this gap bigger than my usual variance?"
 * guard, not a formal test of the KDA estimator.
 */
function noiseHalfWidth(
  metric: DeltaMetric,
  session: SessionMatchInput[],
  baseline: SessionMatchInput[],
): number | null {
  const sessionValues = session
    .map((entry) => perMatchMetric(entry, metric))
    .filter((value): value is number => value !== null);
  const baselineValues = baseline
    .map((entry) => perMatchMetric(entry, metric))
    .filter((value): value is number => value !== null);
  if (sessionValues.length === 0 || baselineValues.length < 2) return null;
  const sd =
    metric === "winrate"
      ? proportionSd(
          baselineValues.reduce((sum, value) => sum + value, 0),
          baselineValues.length,
        )
      : sampleSd(baselineValues);
  if (sd === null) return null;
  return SESSION_DELTA_Z * sd * Math.sqrt(1 / sessionValues.length + 1 / baselineValues.length);
}

/** The four noise half-widths, field-aligned with `computeDelta`: every delta the
 * response exposes has a band to read it against. kda stays null exactly when the
 * delta does -- with no death on either side there is no ratio to put a band
 * around. */
function computeDeltaNoise(
  session: SessionMatchInput[],
  baselineMatches: SessionMatchInput[],
): SessionDeltaNoise {
  return {
    winrate: noiseHalfWidth("winrate", session, baselineMatches),
    kda: noiseHalfWidth("kda", session, baselineMatches),
    deathsPer10Min: noiseHalfWidth("deathsPer10Min", session, baselineMatches),
    xpPerMinute: noiseHalfWidth("xpPerMinute", session, baselineMatches),
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

/** Identity + record of one session, for the picker. Reuses the session's own
 * match list so the counts in the dropdown always match the recap that opens
 * when that session is picked. */
function summarizeSession(matches: SessionMatchInput[]): SessionSummary {
  const wins = matches.filter((entry) => entry.winner).length;
  return {
    startedAt: matches[0]!.playedAt,
    endedAt: matches[matches.length - 1]!.playedAt,
    gamesPlayed: matches.length,
    wins,
    losses: matches.length - wins,
  };
}

/**
 * Builds the E1 recap: the selected session, every selectable session for the
 * picker (most recent first), the player's baseline (every scope match strictly
 * before the session), and the deltas between them.
 *
 * A thin sample no longer suppresses the deltas -- a player who rarely plays 20
 * games in one sitting would never see a comparison at all. The deltas are
 * exposed as soon as there is a session AND a non-empty baseline, and always
 * come with `deltaNoise`: the gap chance alone would produce at that sample
 * size. The UI colours a delta only when it clears that band, so more data is
 * visible without a 5-game session being presented as proof.
 * PROGRESSION_MIN_MATCHES still drives `insufficientSample` as the "both sides
 * are comfortable" notice.
 */
export function buildSessionRecap(matches: SessionMatchInput[], at?: string): SessionRecapCore {
  const ordered = chronological(matches);
  const clustered = clusterSessions(ordered);
  const sessions = clustered.map(summarizeSession).reverse();
  const session = selectSession(clustered, at);
  if (!session) {
    return {
      session: null,
      sessions,
      baseline: null,
      baselineDelta: null,
      deltaNoise: null,
      insufficientSample: true,
    };
  }
  const sessionStart = Date.parse(session[0]!.playedAt);
  const baselineMatches = ordered.filter((entry) => Date.parse(entry.playedAt) < sessionStart);
  const stats = computeSessionStats(session);
  const baseline = computeSessionStats(baselineMatches);
  // With no pre-session match there is no baseline at all: show the session
  // alone rather than a delta invented from an empty mean.
  const comparable = baselineMatches.length > 0;
  const sufficientSample =
    stats.gamesPlayed >= PROGRESSION_MIN_MATCHES &&
    baseline.gamesPlayed >= PROGRESSION_MIN_MATCHES;
  return {
    session: buildSession(session, stats),
    sessions,
    baseline,
    baselineDelta: comparable ? computeDelta(stats, baseline) : null,
    deltaNoise: comparable ? computeDeltaNoise(session, baselineMatches) : null,
    insufficientSample: !sufficientSample,
  };
}
