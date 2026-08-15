/**
 * Client-side mirror of the API's 95% Wilson score interval lower bound
 * (`apps/api/src/lib/wilson.ts`) -- small enough to duplicate rather than
 * share, and needed here so selector dropdowns (hero/map pickers) can flag
 * "unreliable" options without a round trip.
 */
export function wilsonLowerBound(wins: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const phat = wins / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  return (center - margin) / denominator;
}

/** Margin (raw winrate minus its Wilson lower bound) tolerated before a
 * selector option is flagged unreliable -- a wide gap means the sample is
 * too small to trust the displayed winrate. */
export const SELECTOR_RELIABILITY_MARGIN = 0.15;

export function isStatReliable(wins: number, gamesPlayed: number): boolean {
  if (gamesPlayed <= 0) return false;
  const winrate = wins / gamesPlayed;
  return winrate - wilsonLowerBound(wins, gamesPlayed) <= SELECTOR_RELIABILITY_MARGIN;
}
