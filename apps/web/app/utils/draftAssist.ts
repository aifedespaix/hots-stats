import { DRAFT_MIN_RANKED_GAMES_FOR_RANKING } from "@hots-stats/shared-types";
import { wilsonLowerBound } from "./wilson";

/** How many pick suggestions the panel shows. */
export const DRAFT_ASSIST_MAX_PICKS = 3;
/** How many of the viewer's top picks feed the ban search (one
 * /heroes/:heroId/matchups call each). */
export const DRAFT_ASSIST_MAX_LIKELY_HEROES = 3;
/** Score penalty, per already-picked team-mate sharing the role, applied to
 * the Wilson bound: a second healer is worse than a fresh role, all else
 * equal. Expressed on the same 0..1 scale as the bound it subtracts. */
export const DRAFT_ASSIST_CONTESTED_ROLE_PENALTY = 0.1;

const ASSASSIN_ROLES = ["RangedAssassin", "MeleeAssassin"];
const HEALER_ROLE = "Healer";
const TANK_ROLE = "Tank";

export type CompositionWarningKind = "noHealer" | "noTank" | "manyAssassins";

export interface CompositionWarning {
  kind: CompositionWarningKind;
  /** French, ready to render. */
  message: string;
}

export interface RoleCount {
  role: string;
  count: number;
}

export interface CompositionSummary {
  /** Slots whose hero resolved to a known role. */
  resolved: number;
  /** Slots on the team (five). */
  total: number;
  /** Resolved role counts, most frequent first, ties by role name. */
  counts: RoleCount[];
  healerCount: number;
  tankCount: number;
  /** RangedAssassin + MeleeAssassin. */
  assassinCount: number;
  /** Ordered noHealer, noTank, manyAssassins. */
  warnings: CompositionWarning[];
  /** True when at least one slot's hero is still unresolved. */
  partial: boolean;
}

/**
 * Role-by-role composition of one team. Absence warnings ("no healer", "no
 * tank") are only emitted on a *fully resolved* team: with an unresolved slot,
 * "no healer" could be a false alarm, so the panel shows the recognized count
 * instead. The presence warning ("3 assassins") is safe on a partial read:
 * those picks are facts, whatever the remaining plates say.
 */
export function summarizeComposition(slots: Array<{ heroRole: string | null }>): CompositionSummary {
  const total = slots.length;
  const counts = new Map<string, number>();
  for (const slot of slots) {
    if (!slot.heroRole) continue;
    counts.set(slot.heroRole, (counts.get(slot.heroRole) ?? 0) + 1);
  }

  let resolved = 0;
  for (const count of counts.values()) resolved += count;

  const healerCount = counts.get(HEALER_ROLE) ?? 0;
  const tankCount = counts.get(TANK_ROLE) ?? 0;
  let assassinCount = 0;
  for (const role of ASSASSIN_ROLES) assassinCount += counts.get(role) ?? 0;

  const warnings: CompositionWarning[] = [];
  if (total > 0 && resolved === total && healerCount === 0) {
    warnings.push({ kind: "noHealer", message: "Aucun soigneur dans ton équipe." });
  }
  if (total > 0 && resolved === total && tankCount === 0) {
    warnings.push({ kind: "noTank", message: "Aucun tank dans ton équipe." });
  }
  if (assassinCount >= 3) {
    warnings.push({ kind: "manyAssassins", message: "3 assassins ou plus dans ton équipe." });
  }

  const sortedCounts: RoleCount[] = [...counts.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));

  return {
    resolved,
    total,
    counts: sortedCounts,
    healerCount,
    tankCount,
    assassinCount,
    warnings,
    partial: resolved < total,
  };
}

export interface PickCandidateInput {
  heroId: string;
  heroName: string;
  heroRole: string | null;
  gamesPlayed: number;
  wins: number;
  winrate: number;
}

export interface PickSuggestion extends PickCandidateInput {
  wilsonLowerBound: number;
  /** Wilson lower bound minus the contested-role penalty; the ranking key. */
  score: number;
  /** True under DRAFT_MIN_RANKED_GAMES_FOR_RANKING -- shown, but flagged. */
  smallSample: boolean;
}

/**
 * Ranks the viewer's own heroes on the current battleground. Confidence comes
 * first: a hero below DRAFT_MIN_RANKED_GAMES_FOR_RANKING is flagged and sorts
 * after every confident one, so three lucky games never lead the list. Among
 * confident heroes the key is the Wilson lower bound, not the raw winrate,
 * and each role the team already picked subtracts
 * DRAFT_ASSIST_CONTESTED_ROLE_PENALTY -- so a fresh role surfaces over a
 * duplicate. Ties break on more games, then hero name, for a stable order.
 */
export function rankPickSuggestions(
  candidates: PickCandidateInput[],
  takenRoles: Array<string | null>,
  limit = DRAFT_ASSIST_MAX_PICKS,
): PickSuggestion[] {
  const taken = takenRoles.filter((role): role is string => Boolean(role));
  const suggestions: PickSuggestion[] = candidates.map((candidate) => {
    const bound = wilsonLowerBound(candidate.wins, candidate.gamesPlayed);
    const duplicates = candidate.heroRole ? taken.filter((role) => role === candidate.heroRole).length : 0;
    return {
      ...candidate,
      wilsonLowerBound: bound,
      score: bound - duplicates * DRAFT_ASSIST_CONTESTED_ROLE_PENALTY,
      smallSample: candidate.gamesPlayed < DRAFT_MIN_RANKED_GAMES_FOR_RANKING,
    };
  });

  suggestions.sort(
    (a, b) =>
      Number(a.smallSample) - Number(b.smallSample) ||
      b.score - a.score ||
      b.gamesPlayed - a.gamesPlayed ||
      a.heroName.localeCompare(b.heroName),
  );

  return suggestions.slice(0, Math.max(0, limit));
}
