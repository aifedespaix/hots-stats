/**
 * 95% Wilson score interval lower bound -- the "don't get fooled by a 1-game
 * 100% winrate" ranking metric used by the Talent Analyzer (and the map meta
 * table) instead of raw winrate. A talent won once reads 100% raw winrate
 * but a Wilson lower bound near 0, so it no longer outranks a talent with a
 * real sample; a talent at 61% over 340 games keeps most of its winrate as
 * its lower bound. See "Talents & Terrain" design doc, Mission 1.
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
