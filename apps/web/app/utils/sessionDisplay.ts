import type { Tone } from "./tone";

/** Colour of a session-vs-baseline delta: green only when the metric moved in
 * the direction that is good for the player. betterWhen names that direction
 * explicitly, so a lower-is-better metric (deaths) is not coloured backwards. */
export function deltaTone(delta: number | null, betterWhen: "higher" | "lower"): Tone {
  if (delta === null || delta === 0) return "default";
  const improving = betterWhen === "higher" ? delta > 0 : delta < 0;
  return improving ? "success" : "danger";
}

/** Signed fixed-point value (e.g. "+1.4", "-0.3") for deltas that are not
 * percentages or KDA ratios. Avoids printing a negative zero. */
export function formatSignedNumber(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  return (rounded > 0 ? "+" : "") + rounded.toFixed(digits);
}
