export const RANK_MEDALS = ["🥇", "🥈", "🥉"] as const;

/** Emoji médaille pour les 3 premiers rangs, sinon le rang numérique (1-based). */
export function rankMedal(index: number): string {
  return RANK_MEDALS[index] ?? String(index + 1);
}
