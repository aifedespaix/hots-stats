/**
 * The DB's sentinel for "a map's default/only level" -- Postgres can't
 * enforce uniqueness across a nullable composite-key column, so every
 * layer-keyed table (see packages/db/src/schema/{spatial-calibration,
 * match-spatial-grids,match-hero-trajectories,hero-map-spatial-rollup}.ts)
 * stores this instead of the wire format's `null`. Every existing row
 * predating multi-layer support has this value via each layer column's own
 * `DEFAULT ''`.
 */
export const DEFAULT_LAYER_KEY = "";

/** Wire `layer` (`string | null`, possibly `undefined` from an older
 * daemon build's payload) -> DB sentinel. */
export function toDbLayer(layer: string | null | undefined): string {
  return layer ?? DEFAULT_LAYER_KEY;
}

/** DB sentinel -> wire `layer` (`string | null`). */
export function fromDbLayer(layer: string): string | null {
  return layer === DEFAULT_LAYER_KEY ? null : layer;
}
