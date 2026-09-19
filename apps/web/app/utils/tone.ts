/**
 * `info` is not produced by `winrateTone` (a winrate is never "advice") --
 * it's a fourth tone callers can pass explicitly to UiStatTile/UiPanel etc.
 * for coaching tips / astuces, kept visually distinct from `--color-brand`
 * (primary actions, navigation) so a blue callout never reads as a button.
 */
export type Tone = "default" | "success" | "danger" | "info";

/** Tone sémantique pour un winrate (>= threshold => success, sinon danger; null/undefined => default). */
export function winrateTone(winrate: number | null | undefined, threshold = 0.5): Tone {
  if (winrate === null || winrate === undefined) return "default";
  return winrate >= threshold ? "success" : "danger";
}

export const TONE_TEXT_CLASS: Record<Tone, string> = {
  default: "text-foreground",
  success: "text-success",
  danger: "text-danger",
  info: "text-info",
};

/** Subtle tinted card background/border for tone-aware panels (e.g. UiStatTile). */
export const TONE_TILE_CLASS: Record<Tone, string> = {
  default: "border-border bg-surface",
  success: "border-success/25 bg-success/5",
  danger: "border-danger/25 bg-danger/5",
  info: "border-info/25 bg-info/5",
};

/**
 * Redundant win/loss encoding (F3): a glyph carries the same meaning as the
 * success/danger colour, so a result stays readable in greyscale or with a
 * colour-vision deficiency.
 */
export const OUTCOME_GLYPH = { win: "▲", loss: "▼" } as const;

export function outcomeGlyph(won: boolean): string {
  return won ? OUTCOME_GLYPH.win : OUTCOME_GLYPH.loss;
}

/** Glyph for a winrate, derived from `winrateTone` so both stay in sync; null when there is no winrate to judge. */
export function winrateGlyph(winrate: number | null | undefined, threshold = 0.5): string | null {
  const tone = winrateTone(winrate, threshold);
  if (tone === "default") return null;
  return tone === "success" ? OUTCOME_GLYPH.win : OUTCOME_GLYPH.loss;
}
