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
