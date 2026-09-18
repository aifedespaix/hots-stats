import type { PeriodStats, TrendPoint, TrendResponse } from "@hots-stats/shared-types";
import { normalizeMetrics } from "../services/metrics.service";

/** One scope-resolved match feeding the rolling trend (A3). */
export interface TrendMatchInput {
  matchId: string;
  /** ISO datetime. */
  playedAt: string;
  winner: boolean;
  durationSeconds: number;
  kills: number;
  deaths: number;
  assists: number;
  experienceContribution: number;
  gameVersion: string | null;
}

export interface TrendOptions {
  window: number;
  compareTo?: string;
}

function chronological(matches: TrendMatchInput[]): TrendMatchInput[] {
  return [...matches].sort(
    (a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt) || a.matchId.localeCompare(b.matchId),
  );
}

/**
 * Duration-weighted stats over one match set (A3): sum(stat) /
 * (sum(duration)/unit), never an average of per-match ratios. Reuses the A2
 * normalizeMetrics rule for the per-minute / per-10-minute rates. KDA is null
 * (never Infinity) when the set has no death; every rate is 0 when the summed
 * duration is not positive.
 */
export function computePeriodStats(matches: TrendMatchInput[]): PeriodStats {
  let durationSeconds = 0;
  let wins = 0;
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let experienceContribution = 0;
  for (const entry of matches) {
    durationSeconds += entry.durationSeconds;
    if (entry.winner) wins += 1;
    kills += entry.kills;
    deaths += entry.deaths;
    assists += entry.assists;
    experienceContribution += entry.experienceContribution;
  }
  const normalized = normalizeMetrics({
    durationSeconds,
    experienceContribution,
    heroDamage: 0,
    siegeDamage: 0,
    healing: 0,
    damageTaken: 0,
    kills,
    deaths,
    assists,
  });
  return {
    gamesPlayed: matches.length,
    winrate: matches.length > 0 ? wins / matches.length : 0,
    kda: deaths > 0 ? (kills + assists) / deaths : null,
    deathsPer10Min: normalized.deathsPer10Min,
    xpPerMinute: normalized.xpPerMinute,
  };
}

/**
 * Builds the chronological series. All three rolling fields stay null until the
 * trailing window holds window games; afterwards they describe exactly the last
 * window games ending at that point (index 1-based).
 */
export function buildTrendSeries(matches: TrendMatchInput[], window: number): TrendPoint[] {
  const ordered = chronological(matches);
  return ordered.map((entry, i) => {
    const filled = i + 1 >= window;
    let rollingWinrate: number | null = null;
    let rollingKda: number | null = null;
    let rollingDeathsPer10Min: number | null = null;
    if (filled) {
      const stats = computePeriodStats(ordered.slice(i + 1 - window, i + 1));
      rollingWinrate = stats.winrate;
      rollingKda = stats.kda;
      rollingDeathsPer10Min = stats.deathsPer10Min;
    }
    return {
      matchId: entry.matchId,
      playedAt: entry.playedAt,
      winner: entry.winner,
      index: i + 1,
      rollingWinrate,
      rollingKda,
      rollingDeathsPer10Min,
      gameVersion: entry.gameVersion,
    };
  });
}

/**
 * One marker per known gameVersion change, at the first match of the new
 * version. Unknown (null) versions carry no marker (the wire type is a non-null
 * string), and an unknown gap never duplicates the following version's marker.
 */
export function buildVersionChanges(points: TrendPoint[]): TrendResponse["versionChanges"] {
  const changes: TrendResponse["versionChanges"] = [];
  let lastKnown: string | null = null;
  for (const point of points) {
    if (point.gameVersion === null) continue;
    if (lastKnown !== null && point.gameVersion !== lastKnown) {
      changes.push({ atIndex: point.index, gameVersion: point.gameVersion, playedAt: point.playedAt });
    }
    lastKnown = point.gameVersion;
  }
  return changes;
}

/**
 * Splits the series at compareTo into two contiguous periods, each aggregate
 * computed over its own matches alone.
 */
export function buildComparison(
  matches: TrendMatchInput[],
  compareTo: string,
): NonNullable<TrendResponse["comparison"]> {
  const boundary = Date.parse(compareTo);
  const ordered = chronological(matches);
  const previous = ordered.filter((entry) => Date.parse(entry.playedAt) < boundary);
  const current = ordered.filter((entry) => Date.parse(entry.playedAt) >= boundary);
  return [
    {
      label: "Période précédente",
      from: previous[0]?.playedAt ?? compareTo,
      to: compareTo,
      stats: computePeriodStats(previous),
    },
    {
      label: "Période actuelle",
      from: compareTo,
      to: current[current.length - 1]?.playedAt ?? compareTo,
      stats: computePeriodStats(current),
    },
  ];
}

/** Full A3 response: series + patch markers + optional A/B comparison. */
export function buildTrendResponse(matches: TrendMatchInput[], options: TrendOptions): TrendResponse {
  const points = buildTrendSeries(matches, options.window);
  const response: TrendResponse = {
    window: options.window,
    points,
    versionChanges: buildVersionChanges(points),
  };
  if (options.compareTo) response.comparison = buildComparison(matches, options.compareTo);
  return response;
}
