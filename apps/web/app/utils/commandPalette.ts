/**
 * Pure rules behind the Ctrl+K command palette: text normalisation, match
 * scoring, grouping and keyboard ordering. No Nuxt import, no I/O -- the
 * component and the composable only render/feed this module.
 */

import type { MapHubEntry } from "@hots-stats/shared-types";
import type { HeroStats } from "~/types/analytics";
import type { FriendUser } from "~/types/friends";
import type { MatchListItem } from "~/types/matches";

export type CommandPaletteGroupId = "pages" | "context" | "heroes" | "maps" | "friends";

export interface CommandPaletteEntry {
  /** Stable, unique id -- doubles as the DOM id used by aria-activedescendant. */
  id: string;
  label: string;
  group: CommandPaletteGroupId;
  /** Router target. Entries without one are ignored by the palette. */
  to?: string;
  icon?: string;
  /** Extra terms matched in addition to the label (role, battletag, mode...). */
  keywords?: string[];
  /** Secondary line shown under the label. */
  description?: string;
  /** Tie-break inside a group when scores are equal; lower comes first. */
  rank?: number;
}

export interface CommandPaletteGroup {
  id: CommandPaletteGroupId;
  label: string;
  entries: CommandPaletteEntry[];
}

export const COMMAND_GROUP_ORDER: CommandPaletteGroupId[] = [
  "pages",
  "context",
  "heroes",
  "maps",
  "friends",
];

export const COMMAND_GROUP_LABELS: Record<CommandPaletteGroupId, string> = {
  pages: "Pages",
  context: "Sur cette page",
  heroes: "Héros",
  maps: "Cartes",
  friends: "Amis",
};

/** Lowercase, strip accents and collapse whitespace so "Méphisto" matches "mephisto". */
export function normalizeCommandText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type TextMatch = "exact" | "prefix" | "word" | "includes";

const LABEL_SCORES: Record<TextMatch, number> = { exact: 1000, prefix: 800, word: 600, includes: 400 };
const KEYWORD_SCORES: Record<TextMatch, number> = { exact: 350, prefix: 250, word: 150, includes: 50 };

function matchText(text: string, query: string): TextMatch | null {
  if (!text) return null;
  if (text === query) return "exact";
  if (text.startsWith(query)) return "prefix";
  if (text.split(" ").some((word) => word.startsWith(query))) return "word";
  if (text.includes(query)) return "includes";
  return null;
}

/** null when the entry does not match (it is then excluded from the results). */
export function scoreCommandEntry(entry: CommandPaletteEntry, query: string): number | null {
  const normalized = normalizeCommandText(query);
  if (!normalized) return 0;

  const labelMatch = matchText(normalizeCommandText(entry.label), normalized);
  let best = labelMatch ? LABEL_SCORES[labelMatch] : 0;
  for (const keyword of entry.keywords ?? []) {
    const keywordMatch = matchText(normalizeCommandText(keyword), normalized);
    if (keywordMatch) best = Math.max(best, KEYWORD_SCORES[keywordMatch]);
  }
  return best === 0 ? null : best;
}

function compareScored(
  a: { entry: CommandPaletteEntry; score: number },
  b: { entry: CommandPaletteEntry; score: number },
): number {
  return b.score - a.score
    || (a.entry.rank ?? 0) - (b.entry.rank ?? 0)
    || a.entry.label.localeCompare(b.entry.label, "fr");
}

export function groupCommandEntries(
  entries: readonly CommandPaletteEntry[],
  query: string,
): CommandPaletteGroup[] {
  const buckets = new Map<CommandPaletteGroupId, { entry: CommandPaletteEntry; score: number }[]>();
  for (const entry of entries) {
    const score = scoreCommandEntry(entry, query);
    if (score === null) continue;
    const bucket = buckets.get(entry.group) ?? [];
    bucket.push({ entry, score });
    buckets.set(entry.group, bucket);
  }

  return COMMAND_GROUP_ORDER.filter((id) => (buckets.get(id)?.length ?? 0) > 0).map((id) => ({
    id,
    label: COMMAND_GROUP_LABELS[id],
    entries: buckets.get(id)!.sort(compareScored).map((item) => item.entry),
  }));
}

export function flattenCommandGroups(groups: readonly CommandPaletteGroup[]): CommandPaletteEntry[] {
  return groups.flatMap((group) => group.entries);
}

/** Arrow-key index arithmetic with wrapping; -1 when there is nothing to select. */
export function moveCommandSelection(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** Minimal shape the layout already knows for its sidebar entries. */
export interface CommandPageSource {
  to: string;
  label: string;
  icon: string;
}

export function pageCommandEntries(pages: readonly CommandPageSource[]): CommandPaletteEntry[] {
  return pages.map((page) => ({
    id: `page-${page.to}`,
    label: page.label,
    group: "pages",
    to: page.to,
    icon: page.icon,
  }));
}

export function heroCommandEntries(heroes: readonly HeroStats[]): CommandPaletteEntry[] {
  return heroes.map((hero) => ({
    id: `hero-${hero.heroId}`,
    label: hero.heroName,
    group: "heroes",
    to: `/heroes/${hero.heroId}`,
    icon: "i-heroicons-fire",
    keywords: hero.heroRole ? [hero.heroRole] : [],
  }));
}

export function mapCommandEntries(maps: readonly MapHubEntry[]): CommandPaletteEntry[] {
  return maps.map((map) => ({
    id: `map-${map.mapId}`,
    label: map.mapName,
    group: "maps",
    to: `/maps/${map.mapId}`,
    icon: "i-heroicons-map",
  }));
}

export function friendCommandEntries(friends: readonly FriendUser[]): CommandPaletteEntry[] {
  return friends.map((friend) => ({
    id: `friend-${friend.id}`,
    label: friend.displayName,
    group: "friends",
    to: friend.battletag
      ? `/players/${encodeURIComponent(friend.battletag)}`
      : `/friends/${friend.id}`,
    icon: "i-heroicons-user",
    keywords: friend.battletag ? [friend.battletag] : [],
    description: friend.battletag ?? undefined,
  }));
}

export function matchCommandEntries(matches: readonly MatchListItem[]): CommandPaletteEntry[] {
  return matches.map((match, index) => ({
    id: `match-${match.id}`,
    label: `${match.mapName} — ${match.heroName}`,
    group: "context",
    to: `/matches/${match.id}`,
    icon: "i-heroicons-clock",
    keywords: [match.heroName, match.mapName, match.gameMode],
    rank: index,
  }));
}
