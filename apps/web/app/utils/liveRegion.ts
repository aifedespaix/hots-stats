/**
 * F3 live regions. The visible "captured Xs ago" counter ticks every second,
 * but a screen reader must not be interrupted every second: the announced
 * text is throttled to one update per `LIVE_ANNOUNCE_INTERVAL_MS`.
 */
export const LIVE_ANNOUNCE_INTERVAL_MS = 10_000;

/** French label for "captured N seconds ago"; empty when the input is not a finite number. */
export function formatCapturedAgo(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `Capturée il y a ${safe}s`;
  if (safe < 3600) return `Capturée il y a ${Math.round(safe / 60)} min`;
  return `Capturée il y a ${Math.round(safe / 3600)} h`;
}

/** True when the live region may be updated again (the very first reading always may). */
export function shouldAnnounce(
  lastAnnouncedAtMs: number | null,
  nowMs: number,
  intervalMs = LIVE_ANNOUNCE_INTERVAL_MS,
): boolean {
  if (lastAnnouncedAtMs === null) return true;
  return nowMs - lastAnnouncedAtMs >= intervalMs;
}
