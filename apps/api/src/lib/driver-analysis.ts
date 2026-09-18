import { PROGRESSION_MIN_PER_SIDE, RESPAWN_ESTIMATE_SECONDS } from "@hots-stats/shared-types";
import type { DriverMetric, DriversResponse } from "@hots-stats/shared-types";

/** Seconds after gates open at which the "hero level at 10 min" metric is read. */
export const DRIVER_LEVEL_READ_SECONDS = 600;

function mean(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return values.length > 0 ? sum / values.length : 0;
}

function sampleVariance(values: number[], average: number): number {
  if (values.length < 2) return 0;
  let sumSquared = 0;
  for (const value of values) sumSquared += (value - average) ** 2;
  return sumSquared / (values.length - 1);
}

/**
 * Cohen's d for the win-minus-loss contrast: (meanWins - meanLosses) /
 * pooled standard deviation. Positive means the metric is higher in wins.
 *
 * A degenerate split (pooled variance zero) cannot be standardized, so the
 * sign of the raw difference is returned instead: a perfectly clean
 * separation still reads as an effect, an identical distribution on both
 * sides returns exactly 0, and one empty side returns 0. Never NaN or
 * Infinity.
 */
export function cohensD(wins: number[], losses: number[]): number {
  if (wins.length === 0 || losses.length === 0) return 0;
  const meanWins = mean(wins);
  const meanLosses = mean(losses);
  const pooledVariance =
    ((wins.length - 1) * sampleVariance(wins, meanWins) +
      (losses.length - 1) * sampleVariance(losses, meanLosses)) /
    (wins.length + losses.length - 2);
  if (!(pooledVariance > 0)) {
    if (meanWins === meanLosses) return 0;
    return meanWins > meanLosses ? 1 : -1;
  }
  return (meanWins - meanLosses) / Math.sqrt(pooledVariance);
}

/** One scope-resolved match's raw inputs for the A4 driver analysis. */
export interface DriverMatchInput {
  matchId: string;
  winner: boolean;
  durationSeconds: number;
  kills: number;
  deaths: number;
  assists: number;
  heroDamage: number;
  experienceContribution: number;
  /** Kills by every player on the subject's team, subject included. */
  teamKills: number;
  /** Subject deaths before EARLY_DEATH_BEFORE_SECONDS; null when the match has
   * no death log at all (never read as "zero early deaths"). */
  earlyDeaths: number | null;
  /** Whether the subject took the match's first death; null when no death log. */
  firstDeath: boolean | null;
  /** Subject deaths while outnumbered; null when no death log. */
  outnumberedDeaths: number | null;
  /** Subject's hero level at the 10-minute mark; null when unreadable or the
   * match ended before 10 minutes. */
  levelAt10Min: number | null;
}

interface DriverMetricDefinition {
  key: string;
  label: string;
  betterWhen: "higher" | "lower";
  /** null when this match cannot provide the metric. */
  value: (match: DriverMatchInput) => number | null;
}

function perMinute(total: number, durationSeconds: number): number | null {
  if (!(durationSeconds > 0)) return null;
  return total / (durationSeconds / 60);
}

function perTenMinutes(total: number, durationSeconds: number): number | null {
  if (!(durationSeconds > 0)) return null;
  return total / (durationSeconds / 600);
}

const DRIVER_METRICS: DriverMetricDefinition[] = [
  {
    key: "earlyDeaths",
    label: "Morts précoces (avant 5 min)",
    betterWhen: "lower",
    value: (match) => match.earlyDeaths,
  },
  {
    key: "deathsPer10Min",
    label: "Morts / 10 min",
    betterWhen: "lower",
    value: (match) => perTenMinutes(match.deaths, match.durationSeconds),
  },
  {
    key: "firstDeath",
    label: "Première mort de la partie",
    betterWhen: "lower",
    value: (match) => (match.firstDeath === null ? null : match.firstDeath ? 1 : 0),
  },
  {
    key: "outnumberedDeaths",
    label: "Morts en sous-nombre",
    betterWhen: "lower",
    value: (match) => match.outnumberedDeaths,
  },
  {
    key: "xpPerMinute",
    label: "XP / min",
    betterWhen: "higher",
    value: (match) => perMinute(match.experienceContribution, match.durationSeconds),
  },
  {
    key: "heroDamagePerMinute",
    label: "Dégâts héros / min",
    betterWhen: "higher",
    value: (match) => perMinute(match.heroDamage, match.durationSeconds),
  },
  {
    key: "killParticipation",
    label: "Participation aux éliminations",
    betterWhen: "higher",
    value: (match) => (match.teamKills > 0 ? (match.kills + match.assists) / match.teamKills : null),
  },
  {
    key: "timeDeadShare",
    // Estimated from the shared flat respawn constant, never a real timer.
    label: "Part du temps mort (estimation)",
    betterWhen: "lower",
    value: (match) =>
      match.durationSeconds > 0 ? (match.deaths * RESPAWN_ESTIMATE_SECONDS) / match.durationSeconds : null,
  },
  {
    key: "avgHeroLevelAt10Min",
    label: "Niveau de héros à 10 min",
    betterWhen: "higher",
    value: (match) => match.levelAt10Min,
  },
];

function sortDrivers(drivers: DriverMetric[]): DriverMetric[] {
  return [...drivers].sort((a, b) => {
    if (a.reliable !== b.reliable) return a.reliable ? -1 : 1;
    const magnitude = Math.abs(b.effectSize) - Math.abs(a.effectSize);
    if (magnitude !== 0) return magnitude;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Splits every match's metric value into wins and losses and reports the
 * conditional means, Cohen's d and both sample sizes. A metric with no
 * readable value on either side is omitted (source data entirely absent),
 * never returned as a zero; a metric with data on only one side is returned
 * with the matching count and `reliable: false`.
 */
export function computeDrivers(matches: DriverMatchInput[]): DriverMetric[] {
  const drivers: DriverMetric[] = [];
  for (const definition of DRIVER_METRICS) {
    const winValues: number[] = [];
    const lossValues: number[] = [];
    for (const match of matches) {
      const value = definition.value(match);
      if (value === null || !Number.isFinite(value)) continue;
      if (match.winner) winValues.push(value);
      else lossValues.push(value);
    }
    if (winValues.length === 0 && lossValues.length === 0) continue;
    drivers.push({
      key: definition.key,
      label: definition.label,
      betterWhen: definition.betterWhen,
      meanInWins: mean(winValues),
      meanInLosses: mean(lossValues),
      effectSize: cohensD(winValues, lossValues),
      winsSample: winValues.length,
      lossesSample: lossValues.length,
      reliable:
        winValues.length >= PROGRESSION_MIN_PER_SIDE && lossValues.length >= PROGRESSION_MIN_PER_SIDE,
    });
  }
  return sortDrivers(drivers);
}

/** Honest description of the method, shown to the user. */
export const DRIVER_METHODOLOGY =
  "Cohen's d standardisé : écart des moyennes (victoires − défaites) divisé par l'écart-type regroupé des deux groupes. " +
  "Une entrée n'est fiable qu'à partir de " +
  PROGRESSION_MIN_PER_SIDE +
  " parties de chaque côté ; en dessous, seuls les comptes sont affichés. " +
  "Aucun modèle ajusté : chaque statistique est comparée seule, sans contrôle des autres facteurs.";

/** Full A4 response over an already scoped/filtered match set. */
export function buildDriversResponse(
  matches: DriverMatchInput[],
  scope: "personal" | "global",
): DriversResponse {
  return {
    scope,
    matches: matches.length,
    drivers: computeDrivers(matches),
    methodology: DRIVER_METHODOLOGY,
  };
}
