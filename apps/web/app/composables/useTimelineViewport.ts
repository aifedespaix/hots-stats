// Explicit vue import (not Nuxt auto-import) so the geometry is testable with
// plain vitest -- see useMatchTimelineSeries.ts's own comment for the split.
import { computed, type ComputedRef, ref } from "vue";

export interface TimelineWindow {
  startSeconds: number;
  endSeconds: number;
}

/** Never zoom in past this: below a few seconds the chart holds one teamfight
 * at most, and a zero-width window would divide by zero in the pixel maths. */
export const MIN_WINDOW_SECONDS = 5;

/** Pushes a window back inside `[0, durationSeconds]`, keeping its span but
 * never letting it collapse below `minSpan` (or the whole match, when the
 * match is shorter than that). */
export function clampTimelineWindow(
  window: TimelineWindow,
  durationSeconds: number,
  minSpan = MIN_WINDOW_SECONDS,
): TimelineWindow {
  if (durationSeconds <= 0) return { startSeconds: 0, endSeconds: 0 };
  const span = Math.min(durationSeconds, Math.max(minSpan, window.endSeconds - window.startSeconds));
  let start = window.startSeconds;
  if (start < 0) start = 0;
  if (start + span > durationSeconds) start = Math.max(0, durationSeconds - span);
  return { startSeconds: start, endSeconds: start + span };
}

/** Zooms around `anchorSeconds` (the cursor): the anchor keeps its relative
 * place in the window, so wheel-zooming feels anchored to the pointer.
 * `factor` < 1 narrows, > 1 widens. */
export function zoomTimelineWindow(
  window: TimelineWindow,
  anchorSeconds: number,
  factor: number,
  durationSeconds: number,
  minSpan = MIN_WINDOW_SECONDS,
): TimelineWindow {
  const span = Math.max(0, window.endSeconds - window.startSeconds);
  const ratio = span <= 0 ? 0.5 : (anchorSeconds - window.startSeconds) / span;
  const nextSpan = span * factor;
  const start = anchorSeconds - ratio * nextSpan;
  return clampTimelineWindow({ startSeconds: start, endSeconds: start + nextSpan }, durationSeconds, minSpan);
}

/** True when a timestamp falls inside the visible window (inclusive). */
export function isWithinWindow(atSeconds: number, window: TimelineWindow): boolean {
  return atSeconds >= window.startSeconds && atSeconds <= window.endSeconds;
}

export interface UseTimelineViewportResult {
  /** The visible window, already clamped to the match; the whole match when not zoomed. */
  window: ComputedRef<TimelineWindow>;
  isZoomed: ComputedRef<boolean>;
  /** Zoom to an explicit drag-selected range; a range covering the match clears the zoom. */
  zoomTo: (startSeconds: number, endSeconds: number) => void;
  /** Wheel zoom around the cursor. */
  zoomAround: (anchorSeconds: number, factor: number) => void;
  /** Slide the window without resizing it (overview-band drag). */
  panBy: (deltaSeconds: number) => void;
  reset: () => void;
}

/**
 * The chronology's zoom state. `null` means "not zoomed", so the full-match
 * window keeps tracking the match's duration instead of freezing a stale
 * `[0, duration]` pair when the data loads late.
 */
export function useTimelineViewport(durationSeconds: ComputedRef<number>): UseTimelineViewportResult {
  const requested = ref<TimelineWindow | null>(null);

  const window = computed<TimelineWindow>(() =>
    requested.value === null
      ? { startSeconds: 0, endSeconds: Math.max(0, durationSeconds.value) }
      : clampTimelineWindow(requested.value, durationSeconds.value),
  );

  const isZoomed = computed(() => {
    const span = window.value.endSeconds - window.value.startSeconds;
    return span < durationSeconds.value - 1e-6;
  });

  function request(next: TimelineWindow) {
    const clamped = clampTimelineWindow(next, durationSeconds.value);
    const span = clamped.endSeconds - clamped.startSeconds;
    requested.value = span >= durationSeconds.value - 1e-6 ? null : clamped;
  }

  return {
    window,
    isZoomed,
    zoomTo: (startSeconds, endSeconds) => request({ startSeconds, endSeconds }),
    zoomAround: (anchorSeconds, factor) =>
      request(zoomTimelineWindow(window.value, anchorSeconds, factor, durationSeconds.value)),
    panBy: (deltaSeconds) => {
      if (!isZoomed.value) return;
      const { startSeconds, endSeconds } = window.value;
      request({ startSeconds: startSeconds + deltaSeconds, endSeconds: endSeconds + deltaSeconds });
    },
    reset: () => {
      requested.value = null;
    },
  };
}
