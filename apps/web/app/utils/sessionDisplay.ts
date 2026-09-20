import type { SessionSummary } from "@hots-stats/shared-types";
import { formatDate } from "~/composables/useFormat";
import type { Tone } from "./tone";

/** Colour of a session-vs-baseline delta: green only when the metric moved in
 * the direction that is good for the player. betterWhen names that direction
 * explicitly, so a lower-is-better metric (deaths) is not coloured backwards.
 *
 * `noise` is the metric's half-width from chance alone (the API's `deltaNoise`).
 * A gap inside it is not a result, so it stays neutral; passing `null` means the
 * band is unknown, which must not be read as a zero-width one either. Omitting
 * the argument keeps the plain direction colouring for callers with no band. */
export function deltaTone(
  delta: number | null,
  betterWhen: "higher" | "lower",
  noise?: number | null,
): Tone {
  if (delta === null || delta === 0) return "default";
  if (noise === null) return "default";
  if (typeof noise === "number" && Math.abs(delta) <= noise) return "default";
  const improving = betterWhen === "higher" ? delta > 0 : delta < 0;
  return improving ? "success" : "danger";
}

/** Signed fixed-point value (e.g. "+1.4", "-0.3") for deltas that are not
 * percentages or KDA ratios. Avoids printing a negative zero. */
export function formatSignedNumber(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  return (rounded > 0 ? "+" : "") + rounded.toFixed(digits);
}

/** The four session-recap delta metrics, so a noise band is formatted on the
 * same scale as the delta shown next to it. */
export type SessionDeltaMetric = "winrate" | "kda" | "deathsPer10Min" | "xpPerMinute";

/** The band under a delta tile: "± 8 pts" / "± 0.43" / "± 1.2" / "± 45", on the
 * delta's own scale. Empty when the band is unknown, so `UiStatTile` drops the
 * sublabel instead of printing a zero it never measured. */
export function formatDeltaNoise(halfWidth: number | null, metric: SessionDeltaMetric): string {
  if (halfWidth === null) return "";
  switch (metric) {
    case "winrate":
      return "± " + Math.round(halfWidth * 100) + " pts";
    case "kda":
      return "± " + halfWidth.toFixed(2);
    case "deathsPer10Min":
      return "± " + halfWidth.toFixed(1);
    case "xpPerMinute":
      return "± " + Math.round(halfWidth);
  }
}

/** How far back the /session picker reaches by default. */
export const SESSION_PICKER_WINDOW_DAYS = 30;

/** One entry of the session picker: "12/09/2026 20:15 · 5 parties · 3V-2D".
 * The record is shown because two sessions on the same evening are otherwise
 * indistinguishable once the time is truncated to the minute. */
export function formatSessionOption(session: SessionSummary): string {
  const games = session.gamesPlayed === 1 ? "1 partie" : `${session.gamesPlayed} parties`;
  return `${formatDate(session.startedAt)} · ${games} · ${session.wins}V-${session.losses}D`;
}

/**
 * The sessions the picker offers: those inside the last `windowDays`, in the
 * order given (the API returns them most recent first), plus the session
 * currently displayed even when it is older -- otherwise picking an old session
 * would make it disappear from the very list that shows it, and the default
 * "latest" sessions of an inactive player would leave the picker empty.
 */
export function selectableSessions(
  sessions: readonly SessionSummary[],
  selectedStartedAt: string | null,
  now: number,
  windowDays: number = SESSION_PICKER_WINDOW_DAYS,
): SessionSummary[] {
  const threshold = now - windowDays * 24 * 60 * 60 * 1000;
  return sessions.filter(
    (session) =>
      Date.parse(session.startedAt) >= threshold || session.startedAt === selectedStartedAt,
  );
}
