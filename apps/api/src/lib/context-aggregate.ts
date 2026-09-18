import {
  CONTEXT_SESSION_GAP_MINUTES,
  PROGRESSION_MIN_MATCHES,
  UNKNOWN_GAME_VERSION,
  type ContextBreakdown,
  type ContextBucket,
  type ContextResponse,
} from "@hots-stats/shared-types";

/** One scope-resolved match feeding the C4 context breakdown. */
export interface ContextMatchInput {
  matchId: string;
  /** ISO datetime. */
  playedAt: string;
  winner: boolean;
  gameVersion: string | null;
  /** Role counts on the subject's OWN team only (heroes.role -> count); heroes
   * with an unknown role are keyed "unknown". */
  teamRoleCounts: Record<string, number>;
}

/** Where a match sits inside its session. */
export interface SessionPlacement {
  /** 1-based rank of the match within its session. */
  position: number;
  /** Number of matches in that session. */
  size: number;
}

const ROLE_ORDER = ["Tank", "Bruiser", "RangedAssassin", "MeleeAssassin", "Healer", "Support", "unknown"] as const;
const ROLE_LABELS: Record<string, string> = {
  Tank: "Tank",
  Bruiser: "Bagarreur",
  RangedAssassin: "Assassin à distance",
  MeleeAssassin: "Assassin au corps à corps",
  Healer: "Soigneur",
  Support: "Soutien",
  unknown: "Rôle inconnu",
};

/** Monday-first, matching the French labels. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_LABELS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

function chronological(matches: ContextMatchInput[]): ContextMatchInput[] {
  return [...matches].sort(
    (a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt) || a.matchId.localeCompare(b.matchId),
  );
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/** Shifts a UTC instant by the caller's offset (east of UTC, in minutes) so the
 * getUTC* accessors read the caller's local wall clock, independent of the
 * server's own timezone. */
function localDate(playedAt: string, tzOffsetMinutes: number): Date {
  return new Date(Date.parse(playedAt) + tzOffsetMinutes * 60_000);
}

/**
 * Clusters consecutive matches whose start times are at most `gapMinutes` apart
 * into sessions (89 minutes apart = one session, 91 = two). Pure and
 * deterministic: the set is sorted first, so input order does not matter. The
 * start-time gap is the only boundary derivable from the stored timestamps
 * without inventing an end time.
 */
export function sessionizeMatches(
  matches: Array<{ matchId: string; playedAt: string }>,
  gapMinutes: number = CONTEXT_SESSION_GAP_MINUTES,
): Map<string, SessionPlacement> {
  const ordered = [...matches].sort(
    (a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt) || a.matchId.localeCompare(b.matchId),
  );
  const gapMs = gapMinutes * 60_000;
  const sessions: string[][] = [];
  let current: string[] = [];
  let previousMs: number | null = null;
  for (const entry of ordered) {
    const ms = Date.parse(entry.playedAt);
    if (previousMs !== null && ms - previousMs > gapMs && current.length > 0) {
      sessions.push(current);
      current = [];
    }
    current.push(entry.matchId);
    previousMs = ms;
  }
  if (current.length > 0) sessions.push(current);

  const placements = new Map<string, SessionPlacement>();
  for (const session of sessions) {
    session.forEach((matchId, index) => placements.set(matchId, { position: index + 1, size: session.length }));
  }
  return placements;
}

function bucket(key: string, label: string, matches: ContextMatchInput[]): ContextBucket {
  const gamesPlayed = matches.length;
  const wins = matches.filter((entry) => entry.winner).length;
  return {
    key,
    label,
    gamesPlayed,
    wins,
    winrate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    insufficientSample: gamesPlayed < PROGRESSION_MIN_MATCHES,
  };
}

function hourBreakdown(matches: ContextMatchInput[], tzOffsetMinutes: number): ContextBreakdown {
  const grouped = groupBy(matches, (entry) => localDate(entry.playedAt, tzOffsetMinutes).getUTCHours());
  const buckets = Array.from({ length: 24 }, (_, hour) =>
    bucket(String(hour), String(hour).padStart(2, "0") + "h", grouped.get(hour) ?? []),
  );
  return { dimension: "hour", label: "Heure de la journée", buckets };
}

function weekdayBreakdown(matches: ContextMatchInput[], tzOffsetMinutes: number): ContextBreakdown {
  const grouped = groupBy(matches, (entry) => localDate(entry.playedAt, tzOffsetMinutes).getUTCDay());
  const buckets = WEEKDAY_ORDER.map((day) =>
    bucket(String(day), WEEKDAY_LABELS[day] ?? String(day), grouped.get(day) ?? []),
  );
  return { dimension: "weekday", label: "Jour de la semaine", buckets };
}

function sessionPositionBreakdown(
  matches: ContextMatchInput[],
  placements: Map<string, SessionPlacement>,
): ContextBreakdown {
  const grouped = groupBy(matches, (entry) => placements.get(entry.matchId)?.position ?? 0);
  const maxPosition = Math.max(0, ...[...placements.values()].map((placement) => placement.position));
  const buckets = Array.from({ length: maxPosition }, (_, index) => {
    const position = index + 1;
    return bucket(String(position), "Partie n°" + position, grouped.get(position) ?? []);
  });
  return { dimension: "sessionPosition", label: "Rang dans la session", buckets };
}

function sessionSizeBreakdown(
  matches: ContextMatchInput[],
  placements: Map<string, SessionPlacement>,
): ContextBreakdown {
  const grouped = groupBy(matches, (entry) => placements.get(entry.matchId)?.size ?? 0);
  const sizes = [...new Set([...placements.values()].map((placement) => placement.size))].sort((a, b) => a - b);
  const buckets = sizes.map((size) =>
    bucket(String(size), "Session de " + size + " partie" + (size > 1 ? "s" : ""), grouped.get(size) ?? []),
  );
  return { dimension: "sessionSize", label: "Taille de session", buckets };
}

function patchBreakdown(matches: ContextMatchInput[]): ContextBreakdown {
  const grouped = groupBy(matches, (entry) => entry.gameVersion ?? UNKNOWN_GAME_VERSION);
  const versions = [...grouped.keys()].sort((a, b) => {
    if (a === UNKNOWN_GAME_VERSION) return 1;
    if (b === UNKNOWN_GAME_VERSION) return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
  const buckets = versions.map((version) =>
    bucket(version, version === UNKNOWN_GAME_VERSION ? "Version inconnue" : version, grouped.get(version) ?? []),
  );
  return { dimension: "patch", label: "Patch", buckets };
}

function compositionKey(counts: Record<string, number>): string {
  const parts: string[] = [];
  for (const role of ROLE_ORDER) {
    const count = counts[role] ?? 0;
    if (count > 0) parts.push(role + ":" + count);
  }
  return parts.length > 0 ? parts.join("|") : "unknown:0";
}

function compositionLabel(counts: Record<string, number>): string {
  const parts: string[] = [];
  for (const role of ROLE_ORDER) {
    const count = counts[role] ?? 0;
    if (count > 0) parts.push(count + "× " + (ROLE_LABELS[role] ?? role));
  }
  return parts.length > 0 ? parts.join(" · ") : "Composition inconnue";
}

function compositionBreakdown(matches: ContextMatchInput[]): ContextBreakdown {
  const grouped = groupBy(matches, (entry) => compositionKey(entry.teamRoleCounts));
  const buckets = [...grouped.entries()]
    .map(([key, list]) => bucket(key, compositionLabel(list[0]?.teamRoleCounts ?? {}), list))
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.key.localeCompare(b.key));
  return { dimension: "teamComposition", label: "Composition d'équipe", buckets };
}

/** Full C4 response over an already scoped/filtered match set. Empty input still
 * yields the six dimensions (24 hours, 7 weekdays, empty others) so the UI never
 * has to special-case a missing dimension. */
export function buildContextResponse(
  matches: ContextMatchInput[],
  scope: "personal" | "global",
  tzOffsetMinutes: number,
): ContextResponse {
  const ordered = chronological(matches);
  const placements = sessionizeMatches(ordered);
  return {
    scope,
    matches: ordered.length,
    tzOffsetMinutes,
    breakdowns: [
      hourBreakdown(ordered, tzOffsetMinutes),
      weekdayBreakdown(ordered, tzOffsetMinutes),
      sessionPositionBreakdown(ordered, placements),
      sessionSizeBreakdown(ordered, placements),
      patchBreakdown(ordered),
      compositionBreakdown(ordered),
    ],
  };
}
