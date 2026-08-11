import type { GameMode } from "@hots-stats/shared-types";

const gameModeLabels: Record<GameMode, string> = {
  QuickMatch: "Partie rapide",
  UnrankedDraft: "Draft libre",
  HeroLeague: "Ligue des héros",
  TeamLeague: "Ligue d'équipe",
  StormLeague: "Ligue Tempête",
  ARAM: "ARAM",
  Brawl: "Bagarre",
  Custom: "Personnalisée",
};

export function formatGameMode(mode: GameMode): string {
  return gameModeLabels[mode] ?? mode;
}

export function gameModeOptions(): { value: GameMode; label: string }[] {
  return (Object.keys(gameModeLabels) as GameMode[]).map((value) => ({
    value,
    label: gameModeLabels[value],
  }));
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

const heroRoleLabels: Record<string, string> = {
  Tank: "Tank",
  Bruiser: "Bagarreur",
  RangedAssassin: "Assassin à distance",
  MeleeAssassin: "Assassin au corps à corps",
  Healer: "Soigneur",
  Support: "Soutien",
};

export function formatHeroRole(role: string): string {
  return heroRoleLabels[role] ?? role;
}

export function formatAvg(value: number): string {
  return value.toFixed(1);
}
