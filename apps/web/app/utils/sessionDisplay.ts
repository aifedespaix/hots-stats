import type { SessionSummary } from "@hots-stats/shared-types";
import { formatDate } from "~/composables/useFormat";
import type { Tone } from "./tone";

/** Colour of a session-vs-baseline delta: green only when the metric moved in
 * the direction that is good for the player. betterWhen names that direction
 * explicitly, so a lower-is-better metric (deaths) is not coloured backwards. */
export function deltaTone(delta: number | null, betterWhen: "higher" | "lower"): Tone {
  if (delta === null || delta === 0) return "default";
  const improving = betterWhen === "higher" ? delta > 0 : delta < 0;
  return improving ? "success" : "danger";
}

/** Signed fixed-point value (e.g. "+1.4", "-0.3") for deltas that are not
 * percentages or KDA ratios. Avoids printing a negative zero. */
export function formatSignedNumber(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  return (rounded > 0 ? "+" : "") + rounded.toFixed(digits);
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
