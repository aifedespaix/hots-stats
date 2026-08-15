import type { GameMode } from "@hots-stats/shared-types";

/**
 * The 4 tags shown in the header's global game-mode filter. Each tag maps to
 * one or more raw `GameMode` DB values -- "Classé" alone covers 4 historical
 * ranked-queue types (UnrankedDraft/HeroLeague/TeamLeague/StormLeague), same
 * grouping the per-page mode filters used before this became global. Brawl
 * has no tag: it's a rare, low-signal mode nobody asked to filter on here.
 */
export interface GameModeTag {
  key: "ranked" | "quickmatch" | "aram" | "custom";
  label: string;
  modes: GameMode[];
}

export const GAME_MODE_TAGS: GameModeTag[] = [
  { key: "ranked", label: "Classé", modes: ["UnrankedDraft", "HeroLeague", "TeamLeague", "StormLeague"] },
  { key: "quickmatch", label: "QM", modes: ["QuickMatch"] },
  { key: "aram", label: "ARAM", modes: ["ARAM"] },
  { key: "custom", label: "Perso", modes: ["Custom"] },
];

export type GameModeTagKey = GameModeTag["key"];

export const GAME_MODE_TAG_KEYS: GameModeTagKey[] = GAME_MODE_TAGS.map((tag) => tag.key);

export const DEFAULT_GAME_MODE_TAG_KEYS: GameModeTagKey[] = ["ranked"];
