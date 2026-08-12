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

/**
 * Filter-dropdown buckets ("mode" query param on /matches, /players,
 * /heroes) -- grouped down to the game's actual mode selector (Partie
 * rapide / Classé / Bagarre / ARAM / Personnalisée), instead of listing
 * all 8 raw `GameMode` values (which includes 4 separate historical
 * ranked-queue types: UnrankedDraft/HeroLeague/TeamLeague/StormLeague).
 * Each `value` is a comma-joined list of the raw `GameMode`s it covers,
 * sent as-is to the API (see `gameModeListSchema`) -- a match's *stored*
 * `gameMode` is never touched by this, only which filter bucket it falls
 * into. Doesn't include "Contre l'IA": vs-AI replays aren't ingested at
 * all yet (see parser.py's Computer-player rejection), so it would always
 * be an empty filter.
 */
const gameModeFilterGroups: { value: string; label: string }[] = [
  { value: "QuickMatch", label: "Partie rapide" },
  { value: "UnrankedDraft,HeroLeague,TeamLeague,StormLeague", label: "Classé" },
  { value: "Brawl", label: gameModeLabels.Brawl },
  { value: "ARAM", label: gameModeLabels.ARAM },
  { value: "Custom", label: gameModeLabels.Custom },
];

export function gameModeFilterOptions(): { value: string; label: string }[] {
  return gameModeFilterGroups;
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

export function formatHeroRole(role: string | null): string {
  if (role === null) return "Rôle inconnu";
  return heroRoleLabels[role] ?? role;
}

export function formatAvg(value: number): string {
  return value.toFixed(1);
}
