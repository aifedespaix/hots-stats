/** One SVG polyline point-run for the winrate sparkline. */
export interface SparklineGeometry {
  /** One "x,y x,y" polyline point-string per contiguous run of non-null values. */
  segments: string[];
  /** Last plotted point, for the end dot; null when there is nothing to plot. */
  last: { x: number; y: number } | null;
}

const PAD = 2;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Maps rolling winrate values (0..1; null while the rolling window is not
 * filled yet) onto a fixed 0..1 y-domain inside a `width x height` viewBox.
 * The fixed domain is deliberate: a 55% streak must not be stretched to look
 * like a 99% one, and the 50% midpoint stays visually meaningful. Nulls break
 * the line into separate segments instead of bridging a gap.
 */
export function buildWinrateSparkline(
  values: Array<number | null>,
  width: number,
  height: number,
): SparklineGeometry {
  const usableWidth = width - PAD * 2;
  const usableHeight = height - PAD * 2;
  const step = values.length > 1 ? usableWidth / (values.length - 1) : 0;
  const segments: string[] = [];
  let current: string[] = [];
  let last: { x: number; y: number } | null = null;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === null || value === undefined || !Number.isFinite(value)) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
      continue;
    }
    const clamped = Math.min(1, Math.max(0, value));
    const x = round(PAD + index * step);
    const y = round(PAD + (1 - clamped) * usableHeight);
    current.push(x + "," + y);
    last = { x, y };
  }
  if (current.length > 0) segments.push(current.join(" "));
  return { segments, last };
}
