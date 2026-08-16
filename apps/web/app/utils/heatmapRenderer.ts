import type { Grid } from "@hots-stats/shared-types";
import { cellRowCol, maxGridValue } from "@hots-stats/shared-types";
import type { HeatmapPathPoint } from "~/composables/useHeatmapSync";

export interface RgbColorStop {
  offset: number; // 0..1
  rgb: [number, number, number];
}

export interface HeatmapMarker {
  x: number;
  y: number;
}

/** "Bleu foncé -> Cyan/Blanc" -- Game A (self). */
export const GAME_A_PALETTE: RgbColorStop[] = [
  { offset: 0, rgb: [11, 31, 77] },
  { offset: 0.45, rgb: [29, 78, 216] },
  { offset: 0.75, rgb: [56, 189, 248] },
  { offset: 1, rgb: [224, 242, 254] },
];

/** "Rouge foncé -> Jaune/Blanc" -- Game B (reference). */
export const GAME_B_PALETTE: RgbColorStop[] = [
  { offset: 0, rgb: [69, 10, 10] },
  { offset: 0.45, rgb: [185, 28, 28] },
  { offset: 0.75, rgb: [245, 158, 11] },
  { offset: 1, rgb: [254, 249, 195] },
];

/**
 * Diverging pair for the delta heatmap toggle (A-minus-B): cyan for "A went
 * here, B didn't", amber for the reverse -- deliberately the same hue
 * families as each game's own sequential palette above (`GAME_A_PALETTE`'s
 * bright end is cyan, `GAME_B_PALETTE`'s is amber), so a divergent zone's
 * color still reads as "which game" at a glance. Validated colorblind-safe
 * via the project's `dataviz` skill (`validate_palette.js`): normal-vision
 * ΔE 27.2, protan/tritan >= 19 -- both comfortably above the >= 8 pass floor.
 */
export const DELTA_POSITIVE_RGB: [number, number, number] = [8, 145, 178]; // A-only, cyan-700
export const DELTA_NEGATIVE_RGB: [number, number, number] = [217, 119, 6]; // B-only, amber-600

function buildColorLut(stops: RgbColorStop[]): Uint8ClampedArray {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let lower = sorted[0]!;
    let upper = sorted[sorted.length - 1]!;
    for (let s = 0; s < sorted.length - 1; s++) {
      if (t >= sorted[s]!.offset && t <= sorted[s + 1]!.offset) {
        lower = sorted[s]!;
        upper = sorted[s + 1]!;
        break;
      }
    }
    const span = upper.offset - lower.offset;
    const localT = span > 0 ? (t - lower.offset) / span : 0;
    lut[i * 3] = lower.rgb[0] + (upper.rgb[0] - lower.rgb[0]) * localT;
    lut[i * 3 + 1] = lower.rgb[1] + (upper.rgb[1] - lower.rgb[1]) * localT;
    lut[i * 3 + 2] = lower.rgb[2] + (upper.rgb[2] - lower.rgb[2]) * localT;
  }
  return lut;
}

/** Solid-color LUT (used for the delta view's two single-hue layers --
 * intensity there comes from alpha alone, not a light-to-dark ramp, so
 * every divergent cell of the same sign reads as the same hue). */
function buildSolidLut(rgb: [number, number, number]): Uint8ClampedArray {
  return buildColorLut([
    { offset: 0, rgb },
    { offset: 1, rgb },
  ]);
}

interface HeatmapLayer {
  grid: Grid;
  lut: Uint8ClampedArray;
  maxValue: number;
}

/** Floor alpha for the least-intense occupied cell, so a lightly-visited
 * zone doesn't fade to invisible against the map -- matches
 * `SpatialCanvasLayer.vue`'s existing precedent of scaling opacity by
 * intensity without letting it hit zero for any occupied cell. */
const MIN_CELL_ALPHA = 60;

/**
 * Renders one heatmap pane (density grid + optional rotation path + event
 * markers) onto a `<canvas>` sized to the map image's natural pixel
 * dimensions -- same convention as `SpatialCanvasLayer.vue`, so CSS
 * `object-fit: contain` handles the responsive letterboxing with zero JS
 * math, and `ProComparisonView.vue` layers a shared CSS `transform` on top
 * for pan/zoom (kept out of this class entirely: it's DOM/CSS state the
 * two panes must agree on pixel-for-pixel, which a shared `transform:`
 * binding guarantees far more cheaply than re-deriving it on every canvas
 * redraw).
 *
 * Batches the density grid into an offscreen bitmap only when the data
 * actually changes (`setData`/`setDeltaData`), not on every frame -- the
 * per-cell `fillRect` work `SpatialCanvasLayer.vue` does on every redraw is
 * done here once, then every `render()` is a single `drawImage` scale-up
 * (GPU-accelerated) plus a handful of path/marker draw calls. All public
 * setters schedule a single coalesced `requestAnimationFrame`, so several
 * prop changes in the same tick still only repaint once.
 */
export class HeatmapRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bitmapCanvas: HTMLCanvasElement;
  private readonly primaryLut: Uint8ClampedArray;
  private readonly secondaryLut: Uint8ClampedArray;

  private naturalWidth = 0;
  private naturalHeight = 0;
  private gridCols = 0;
  private gridRows = 0;
  private layers: HeatmapLayer[] = [];
  private path: HeatmapPathPoint[] = [];
  private markers: HeatmapMarker[] = [];

  private bitmapDirty = true;
  private frameHandle: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    primaryColorStops: RgbColorStop[],
    secondaryRgb: [number, number, number] = DELTA_NEGATIVE_RGB,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.primaryLut = buildColorLut(primaryColorStops);
    this.secondaryLut = buildSolidLut(secondaryRgb);
    this.bitmapCanvas = document.createElement("canvas");
  }

  setMapSize(naturalWidth: number, naturalHeight: number) {
    if (this.naturalWidth === naturalWidth && this.naturalHeight === naturalHeight) return;
    this.naturalWidth = naturalWidth;
    this.naturalHeight = naturalHeight;
    if (this.canvas.width !== naturalWidth) this.canvas.width = naturalWidth;
    if (this.canvas.height !== naturalHeight) this.canvas.height = naturalHeight;
    this.scheduleFrame();
  }

  /** Single-layer density grid (a normal per-game pane) -- uses this
   * instance's primary palette (`GAME_A_PALETTE`/`GAME_B_PALETTE`). */
  setData(grid: Grid, cols: number, rows: number) {
    this.gridCols = cols;
    this.gridRows = rows;
    this.layers = [{ grid, lut: this.primaryLut, maxValue: maxGridValue(grid) }];
    this.bitmapDirty = true;
    this.scheduleFrame();
  }

  /** Two-layer diverging grid (the delta toggle) -- `positive`/`negative`
   * come from `splitDeltaGrid`. Normalized against a *shared* max across
   * both, not each independently, so a small divergence doesn't render as
   * visually intense as a large one just because it's the bigger value in
   * its own half. */
  setDeltaData(positive: Grid, negative: Grid, cols: number, rows: number) {
    this.gridCols = cols;
    this.gridRows = rows;
    const sharedMax = Math.max(maxGridValue(positive), maxGridValue(negative));
    this.layers = [
      { grid: positive, lut: this.primaryLut, maxValue: sharedMax },
      { grid: negative, lut: this.secondaryLut, maxValue: sharedMax },
    ];
    this.bitmapDirty = true;
    this.scheduleFrame();
  }

  setPath(points: HeatmapPathPoint[]) {
    this.path = points;
    this.scheduleFrame();
  }

  setMarkers(markers: HeatmapMarker[]) {
    this.markers = markers;
    this.scheduleFrame();
  }

  destroy() {
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private scheduleFrame() {
    if (this.frameHandle !== null) return;
    this.frameHandle = requestAnimationFrame(() => {
      this.frameHandle = null;
      this.render();
    });
  }

  private rebuildBitmap() {
    if (this.gridCols <= 0 || this.gridRows <= 0) return;
    if (this.bitmapCanvas.width !== this.gridCols) this.bitmapCanvas.width = this.gridCols;
    if (this.bitmapCanvas.height !== this.gridRows) this.bitmapCanvas.height = this.gridRows;
    const bitmapCtx = this.bitmapCanvas.getContext("2d");
    if (!bitmapCtx) return;

    const imageData = bitmapCtx.createImageData(this.gridCols, this.gridRows);
    for (const layer of this.layers) {
      if (layer.maxValue <= 0) continue;
      for (const [key, value] of Object.entries(layer.grid)) {
        const { col, row } = cellRowCol(Number(key), this.gridCols);
        // Row 0 = world-Y-min = bottom of the map (see mapProjection.ts's Y
        // inversion) -- flip into image-pixel space, where row 0 is the top.
        const pixelRow = this.gridRows - 1 - row;
        const pixelIndex = (pixelRow * this.gridCols + col) * 4;
        const intensity = Math.round(Math.min(1, value / layer.maxValue) * 255);
        imageData.data[pixelIndex] = layer.lut[intensity * 3]!;
        imageData.data[pixelIndex + 1] = layer.lut[intensity * 3 + 1]!;
        imageData.data[pixelIndex + 2] = layer.lut[intensity * 3 + 2]!;
        imageData.data[pixelIndex + 3] = Math.max(MIN_CELL_ALPHA, intensity);
      }
    }
    bitmapCtx.putImageData(imageData, 0, 0);
    this.bitmapDirty = false;
  }

  private render() {
    if (!this.naturalWidth || !this.naturalHeight) return;
    if (this.bitmapDirty) this.rebuildBitmap();

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.naturalWidth, this.naturalHeight);

    if (this.gridCols > 0 && this.gridRows > 0) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.bitmapCanvas, 0, 0, this.gridCols, this.gridRows, 0, 0, this.naturalWidth, this.naturalHeight);
    }

    this.drawPath(ctx);
    this.drawMarkers(ctx);
  }

  private toCanvasPixel(point: { x: number; y: number }): [number, number] {
    // Same normalized-[0,1]-to-pixel Y inversion as mapProjection.ts's
    // `projectRawPoint`, kept in agreement by construction.
    return [point.x * this.naturalWidth, (1 - point.y) * this.naturalHeight];
  }

  private drawPath(ctx: CanvasRenderingContext2D) {
    if (this.path.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    this.path.forEach((point, i) => {
      const [px, py] = this.toCanvasPixel(point);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Direction arrowhead at the path's endpoint, so a rotation's direction
    // of travel is legible without hovering/scrubbing the timeline.
    const last = this.path[this.path.length - 1]!;
    const prev = this.path[this.path.length - 2]!;
    const [lastX, lastY] = this.toCanvasPixel(last);
    const [prevX, prevY] = this.toCanvasPixel(prev);
    const angle = Math.atan2(lastY - prevY, lastX - prevX);
    const size = 6;
    ctx.save();
    ctx.translate(lastX, lastY);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size * 1.6, -size * 0.7);
    ctx.lineTo(-size * 1.6, size * 0.7);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fill();
    ctx.restore();
  }

  private drawMarkers(ctx: CanvasRenderingContext2D) {
    if (this.markers.length === 0) return;
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 1;
    for (const marker of this.markers) {
      const [px, py] = this.toCanvasPixel(marker);
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

/** Splits a delta grid (see `useHeatmapSync`'s `deltaGrid`, A-minus-B) into
 * its positive half ("A went here, B didn't") and negative half (sign
 * flipped to a positive magnitude, "B went here, A didn't") -- feeds
 * `HeatmapRenderer.setDeltaData`'s two layers. */
export function splitDeltaGrid(delta: Grid): { positive: Grid; negative: Grid } {
  const positive: Grid = {};
  const negative: Grid = {};
  for (const [key, value] of Object.entries(delta)) {
    if (value > 0) positive[key] = value;
    else if (value < 0) negative[key] = -value;
  }
  return { positive, negative };
}
