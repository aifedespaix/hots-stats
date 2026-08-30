/**
 * Colorblind-safe RGB palette (Okabe & Ito, 2008 -- the standard reference
 * palette for categorical data in accessibility-conscious dataviz, chosen
 * here over an ad-hoc palette + the project's own `dataviz` validator so the
 * distinguishability guarantee is off-the-shelf rather than something to
 * re-verify by hand every time a color is tweaked).
 *
 * Used two ways by `SpatialSlotGroup.vue` (see
 * tasks/epic-10-analyse-spatiale.md's "Charte de couleurs"):
 * - **1 Slot, several heroes selected**: each hero gets the next color from
 *   `HERO_CATEGORICAL_PALETTE`, cycling if there are more heroes than colors.
 * - **2 Slots active (comparison mode)**: color is fixed per Slot, not per
 *   hero -- `SLOT_A_RGB`/`SLOT_B_RGB`, both drawn from the same palette so a
 *   1-Slot and a 2-Slot view never clash on what "blue" or "orange" means.
 */
export const HERO_CATEGORICAL_PALETTE: [number, number, number][] = [
  [0, 114, 178], // blue
  [213, 94, 0], // vermillion
  [0, 158, 115], // bluish green
  [230, 159, 0], // orange
  [204, 121, 167], // reddish purple
  [86, 180, 233], // sky blue
  [240, 228, 66], // yellow
];

export function colorForHeroIndex(index: number): [number, number, number] {
  return HERO_CATEGORICAL_PALETTE[index % HERO_CATEGORICAL_PALETTE.length]!;
}

/** Fixed per-Slot colors for the 2-Slot comparison mode -- same blue/vermillion pair as the categorical palette's first two entries. */
export const SLOT_A_RGB: [number, number, number] = HERO_CATEGORICAL_PALETTE[0]!;
export const SLOT_B_RGB: [number, number, number] = HERO_CATEGORICAL_PALETTE[1]!;

/** Ally/enemy colors for the "Par équipe" mode -- matches `SpatialHeatmapView.vue`'s existing static approximations of `--raw-info`/`--raw-danger`. */
export const ALLY_TEAM_RGB: [number, number, number] = [59, 130, 246];
export const ENEMY_TEAM_RGB: [number, number, number] = [239, 68, 68];

export const KILL_MARKER_RGB: [number, number, number] = [34, 197, 94]; // ~ --raw-success
export const DEATH_MARKER_RGB: [number, number, number] = [239, 68, 68]; // ~ --raw-danger
