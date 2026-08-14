export type Tone = "default" | "success" | "danger";

/** Tone sémantique pour un winrate (>= threshold => success, sinon danger; null/undefined => default). */
export function winrateTone(winrate: number | null | undefined, threshold = 0.5): Tone {
  if (winrate === null || winrate === undefined) return "default";
  return winrate >= threshold ? "success" : "danger";
}

export const TONE_TEXT_CLASS: Record<Tone, string> = {
  default: "text-foreground",
  success: "text-success",
  danger: "text-danger",
};
