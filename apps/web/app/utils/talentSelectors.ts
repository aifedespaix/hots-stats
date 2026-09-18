/**
 * Shared ordering for the Talent Analyzer's two linked selects. Each list is
 * fetched through the other's current value (`/heroes?mapId=`, `/maps?heroId=`),
 * so `gamesPlayed` on an item is that entry's games **for the opposite
 * selection** -- ordering by it puts the combinations actually played first
 * and keeps the two fields in step.
 */

/** The minimum shape both selector items share. */
export interface RankableSelectorItem {
  label: string;
  gamesPlayed: number;
}

/**
 * Returns the items most-played first, ties broken alphabetically.
 *
 * `hideUnplayed` drops zero-game entries entirely: the Hero select only ever
 * contains heroes played on the chosen map, so the Map select hides maps the
 * chosen hero was never played on to match. With no opposite selection, the
 * full list is kept (Hub-style browse) and unplayed entries simply sink to
 * the bottom.
 */
export function rankSelectorOptions<T extends RankableSelectorItem>(
  items: T[],
  { hideUnplayed }: { hideUnplayed: boolean },
): T[] {
  const visible = hideUnplayed ? items.filter((item) => item.gamesPlayed > 0) : items;
  return [...visible].sort(
    (a, b) => b.gamesPlayed - a.gamesPlayed || a.label.localeCompare(b.label),
  );
}
