/** Icon shown next to a hero role in the "Dashboard" cards -- Heroicons only, kept to names already proven to resolve in this project. */
const ROLE_ICONS: Record<string, string> = {
  Tank: "i-heroicons-shield-check",
  Bruiser: "i-heroicons-fire",
  RangedAssassin: "i-heroicons-cursor-arrow-rays",
  MeleeAssassin: "i-heroicons-bolt",
  Healer: "i-heroicons-heart",
  Support: "i-heroicons-sparkles",
};

export function heroRoleIcon(role: string | null): string {
  if (role === null) return "i-heroicons-question-mark-circle";
  return ROLE_ICONS[role] ?? "i-heroicons-user";
}

/**
 * Flat, theme-independent palette for the 6 hero roles, used by the "temps
 * de jeu par rôle" doughnut chart. Deliberately not derived from the
 * `--color-*` design tokens (only 4 exist -- primary/accent/success/danger),
 * chosen instead for readability on both light and dark surfaces.
 */
const ROLE_COLORS: Record<string, string> = {
  Tank: "#5b8def",
  Bruiser: "#f2994a",
  RangedAssassin: "#eb5757",
  MeleeAssassin: "#bb6bd9",
  Healer: "#27ae60",
  Support: "#2fd4c8",
};

export function heroRoleColor(role: string | null): string {
  if (role === null) return "#8a94a6";
  return ROLE_COLORS[role] ?? "#8a94a6";
}
