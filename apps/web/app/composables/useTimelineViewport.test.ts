import { computed, ref } from "vue";
import { describe, expect, it } from "vitest";
import {
  MIN_WINDOW_SECONDS,
  clampTimelineWindow,
  isWithinWindow,
  useTimelineViewport,
  zoomTimelineWindow,
} from "./useTimelineViewport";
import { advancePlayback, nextPlaybackSpeed, useTimelinePlayback } from "./useTimelinePlayback";

describe("clampTimelineWindow", () => {
  it("keeps a window inside the match without resizing it", () => {
    expect(clampTimelineWindow({ startSeconds: 250, endSeconds: 300 }, 400)).toEqual({
      startSeconds: 250,
      endSeconds: 300,
    });
    expect(clampTimelineWindow({ startSeconds: -30, endSeconds: 20 }, 400)).toEqual({
      startSeconds: 0,
      endSeconds: 50,
    });
    expect(clampTimelineWindow({ startSeconds: 380, endSeconds: 430 }, 400)).toEqual({
      startSeconds: 350,
      endSeconds: 400,
    });
  });

  it("never collapses below the minimum span", () => {
    expect(clampTimelineWindow({ startSeconds: 100, endSeconds: 100.5 }, 400)).toEqual({
      startSeconds: 100,
      endSeconds: 100 + MIN_WINDOW_SECONDS,
    });
  });

  it("lets a match shorter than the minimum span keep its own duration as the span", () => {
    expect(clampTimelineWindow({ startSeconds: 0, endSeconds: 1 }, 2)).toEqual({ startSeconds: 0, endSeconds: 2 });
  });

  it("collapses to zero for a match with no duration", () => {
    expect(clampTimelineWindow({ startSeconds: 10, endSeconds: 40 }, 0)).toEqual({ startSeconds: 0, endSeconds: 0 });
  });
});

describe("zoomTimelineWindow", () => {
  const full = { startSeconds: 0, endSeconds: 400 };

  it("narrows around the anchor while keeping its relative place", () => {
    const zoomed = zoomTimelineWindow(full, 100, 0.5, 400);
    expect(zoomed).toEqual({ startSeconds: 50, endSeconds: 250 });
    // The anchor stays a quarter of the way into the window.
    expect((100 - zoomed.startSeconds) / (zoomed.endSeconds - zoomed.startSeconds)).toBeCloseTo(0.25, 10);
  });

  it("widens but clamps to the whole match", () => {
    const zoomed = zoomTimelineWindow({ startSeconds: 100, endSeconds: 200 }, 150, 4, 400);
    expect(zoomed).toEqual({ startSeconds: 0, endSeconds: 400 });
  });

  it("stops narrowing at the minimum span", () => {
    const zoomed = zoomTimelineWindow({ startSeconds: 90, endSeconds: 100 }, 95, 0.01, 400);
    expect(zoomed.endSeconds - zoomed.startSeconds).toBe(MIN_WINDOW_SECONDS);
  });
});

describe("isWithinWindow", () => {
  it("includes both edges", () => {
    const window = { startSeconds: 10, endSeconds: 20 };
    expect(isWithinWindow(10, window)).toBe(true);
    expect(isWithinWindow(20, window)).toBe(true);
    expect(isWithinWindow(9.9, window)).toBe(false);
  });
});

describe("useTimelineViewport", () => {
  function viewport(duration = ref(400)) {
    return useTimelineViewport(computed(() => duration.value));
  }

  it("starts on the whole match and reports not zoomed", () => {
    const { window, isZoomed } = viewport();
    expect(window.value).toEqual({ startSeconds: 0, endSeconds: 400 });
    expect(isZoomed.value).toBe(false);
  });

  it("zooms to an explicit range and clears it when the range covers the match", () => {
    const { window, isZoomed, zoomTo } = viewport();
    zoomTo(60, 120);
    expect(window.value).toEqual({ startSeconds: 60, endSeconds: 120 });
    expect(isZoomed.value).toBe(true);

    zoomTo(0, 400);
    expect(isZoomed.value).toBe(false);
    expect(window.value).toEqual({ startSeconds: 0, endSeconds: 400 });
  });

  it("tracks the match duration while unzoomed, so a late duration is picked up", () => {
    const duration = ref(0);
    const { window } = viewport(duration);
    expect(window.value).toEqual({ startSeconds: 0, endSeconds: 0 });
    duration.value = 600;
    expect(window.value).toEqual({ startSeconds: 0, endSeconds: 600 });
  });

  it("pans a zoomed window and stops at the edges", () => {
    const { window, zoomTo, panBy } = viewport();
    zoomTo(100, 200);
    panBy(50);
    expect(window.value).toEqual({ startSeconds: 150, endSeconds: 250 });
    panBy(1000);
    expect(window.value).toEqual({ startSeconds: 300, endSeconds: 400 });
    panBy(-1000);
    expect(window.value).toEqual({ startSeconds: 0, endSeconds: 100 });
  });

  it("ignores a pan while unzoomed, so the whole match cannot slide off", () => {
    const { window, panBy } = viewport();
    panBy(100);
    expect(window.value).toEqual({ startSeconds: 0, endSeconds: 400 });
  });

  it("narrows on a wheel-in and resets on demand", () => {
    const { window, isZoomed, zoomAround, reset } = viewport();
    zoomAround(200, 0.5);
    expect(window.value).toEqual({ startSeconds: 100, endSeconds: 300 });
    expect(isZoomed.value).toBe(true);
    reset();
    expect(window.value).toEqual({ startSeconds: 0, endSeconds: 400 });
  });
});

describe("nextPlaybackSpeed", () => {
  it("cycles 1 -> 2 -> 4 -> 1", () => {
    expect(nextPlaybackSpeed(1)).toBe(2);
    expect(nextPlaybackSpeed(2)).toBe(4);
    expect(nextPlaybackSpeed(4)).toBe(1);
  });

  it("falls back to the first speed for an unknown value", () => {
    expect(nextPlaybackSpeed(3)).toBe(1);
  });
});

describe("advancePlayback", () => {
  it("turns elapsed wall time into match time at the given speed", () => {
    expect(advancePlayback(10, 1000, 1, 300)).toEqual({ positionSeconds: 11, finished: false });
    expect(advancePlayback(10, 1000, 4, 300)).toEqual({ positionSeconds: 14, finished: false });
  });

  it("clamps at the end of the match and reports it finished", () => {
    expect(advancePlayback(299, 2000, 1, 300)).toEqual({ positionSeconds: 300, finished: true });
    expect(advancePlayback(300, 1000, 1, 300)).toEqual({ positionSeconds: 300, finished: true });
  });

  it("treats a negative elapsed time as no time at all", () => {
    expect(advancePlayback(10, -500, 1, 300)).toEqual({ positionSeconds: 10, finished: false });
  });

  it("is immediately finished for a match with no duration", () => {
    expect(advancePlayback(10, 1000, 1, 0)).toEqual({ positionSeconds: 0, finished: true });
  });
});

describe("useTimelinePlayback", () => {
  function playback(position = 0, duration = 300) {
    const positionSeconds = ref(position);
    const result = useTimelinePlayback({
      positionSeconds,
      durationSeconds: computed(() => duration),
    });
    return { positionSeconds, ...result };
  }

  it("starts paused at 1x", () => {
    const { playing, speed } = playback();
    expect(playing.value).toBe(false);
    expect(speed.value).toBe(1);
  });

  it("toggles playing and back", () => {
    const { playing, toggle } = playback();
    toggle();
    expect(playing.value).toBe(true);
    toggle();
    expect(playing.value).toBe(false);
  });

  it("rewinds to the start when played from the end", () => {
    const { positionSeconds, start, playing } = playback(300);
    start();
    expect(positionSeconds.value).toBe(0);
    expect(playing.value).toBe(true);
  });

  it("refuses to play a match with no duration", () => {
    const { playing, start } = playback(0, 0);
    start();
    expect(playing.value).toBe(false);
  });

  it("cycles the speed and stops on demand", () => {
    const { speed, cycleSpeed, start, stop, playing } = playback();
    cycleSpeed();
    expect(speed.value).toBe(2);
    start();
    stop();
    expect(playing.value).toBe(false);
  });
});
