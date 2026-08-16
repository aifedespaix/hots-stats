export interface MapBoundsInput {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Normalizes a raw in-game position against `bounds`, then projects it onto
 * a `canvasWidth` x `canvasHeight` pixel space. Y is inverted
 * (`pxY = (1 - yn) * canvasHeight`): game engines conventionally have Y
 * increasing upward, screens have it increasing downward -- see
 * tasks/epic-10-analyse-spatiale.md Livrable 2, which this calibration tool
 * shares the exact formula with so the two stay in agreement by
 * construction.
 *
 * Guards `maxX === minX` / `maxY === minY` (returns `0` for that axis)
 * rather than dividing by zero -- a real possibility while an admin is
 * still typing bounds into the calibration form.
 */
export function projectRawPoint(
  point: { x: number; y: number },
  bounds: MapBoundsInput,
  canvasWidth: number,
  canvasHeight: number,
): { pxX: number; pxY: number } {
  const xn = bounds.maxX === bounds.minX ? 0 : (point.x - bounds.minX) / (bounds.maxX - bounds.minX);
  const yn = bounds.maxY === bounds.minY ? 0 : (point.y - bounds.minY) / (bounds.maxY - bounds.minY);
  return { pxX: xn * canvasWidth, pxY: (1 - yn) * canvasHeight };
}
