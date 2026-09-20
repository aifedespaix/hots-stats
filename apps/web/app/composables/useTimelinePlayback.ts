// Explicit vue import (not Nuxt auto-import) so the clock is testable with
// plain vitest -- see useMatchTimelineSeries.ts's own comment for the split.
import { getCurrentScope, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";

export const PLAYBACK_SPEEDS = [1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** The speed the speed button cycles to next. */
export function nextPlaybackSpeed(speed: number): PlaybackSpeed {
  const index = PLAYBACK_SPEEDS.indexOf(speed as PlaybackSpeed);
  return PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length]!;
}

export interface PlaybackTick {
  positionSeconds: number;
  /** True when this tick reached the end of the match, so the caller stops. */
  finished: boolean;
}

/** One clock tick: `elapsedMs` of wall time becomes `elapsedMs * speed` of
 * match time, clamped to the match's bounds. Pure so the speed maths is
 * testable without a browser frame clock. */
export function advancePlayback(
  positionSeconds: number,
  elapsedMs: number,
  speed: number,
  durationSeconds: number,
): PlaybackTick {
  if (durationSeconds <= 0) return { positionSeconds: 0, finished: true };
  const next = positionSeconds + (Math.max(0, elapsedMs) / 1000) * speed;
  if (next >= durationSeconds) return { positionSeconds: durationSeconds, finished: true };
  return { positionSeconds: Math.max(0, next), finished: false };
}

export interface UseTimelinePlaybackOptions {
  /** The shared cursor -- playback writes it, the scrubber and hover also do. */
  positionSeconds: Ref<number>;
  durationSeconds: ComputedRef<number>;
}

export interface UseTimelinePlaybackResult {
  playing: Ref<boolean>;
  /** 1 | 2 | 4, cycled by `cycleSpeed`. */
  speed: Ref<number>;
  start: () => void;
  pause: () => void;
  toggle: () => void;
  cycleSpeed: () => void;
  /** Same as pause, named for the "leaving the tab" call site. */
  stop: () => void;
}

/**
 * Drives the shared cursor forward while playing. Uses requestAnimationFrame
 * so playback shares the render loop (no timer fighting the chart), and writes
 * at most once per frame so the shared heatmap highlight isn't redrawn in a
 * tighter loop than the browser paints.
 */
export function useTimelinePlayback({
  positionSeconds,
  durationSeconds,
}: UseTimelinePlaybackOptions): UseTimelinePlaybackResult {
  const playing = ref(false);
  const speed = ref<number>(1);
  let frame: number | null = null;
  let lastTimestamp: number | null = null;

  function cancelFrame() {
    if (frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    frame = null;
    lastTimestamp = null;
  }

  function tick(timestamp: number) {
    if (!playing.value) return;
    const elapsed = lastTimestamp === null ? 0 : timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    const next = advancePlayback(positionSeconds.value, elapsed, speed.value, durationSeconds.value);
    positionSeconds.value = next.positionSeconds;
    if (next.finished) {
      pause();
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function start() {
    if (durationSeconds.value <= 0 || playing.value) return;
    // Restarting from the end replays the match instead of sitting still.
    if (positionSeconds.value >= durationSeconds.value) positionSeconds.value = 0;
    playing.value = true;
    lastTimestamp = null;
    if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(tick);
  }

  function pause() {
    playing.value = false;
    cancelFrame();
  }

  function toggle() {
    if (playing.value) pause();
    else start();
  }

  function cycleSpeed() {
    speed.value = nextPlaybackSpeed(speed.value);
  }

  if (getCurrentScope()) onScopeDispose(pause);

  return { playing, speed, start, pause, toggle, cycleSpeed, stop: pause };
}
