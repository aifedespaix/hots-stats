// Explicit vue import (not Nuxt auto-import) so the pure logic is testable
// with plain vitest -- see useHeatmapSync.ts's own comment, the repo's
// precedent for this split.
import { computed, type ComputedRef, type Ref, type WritableComputedRef, ref } from "vue";
import type {
  MatchTimelineData,
  MatchTimelineDeathMarker,
  MatchTimelineEvent,
  MatchTimelineFocus,
  MatchTimelineLane,
  MatchTimelineLeadPoint,
  MatchTimelineLevelStep,
  MatchTimelineSeries,
  MatchTimelineStateAt,
  MatchTimelineStateDeath,
  MatchTimelineStructureEvent,
  MatchTimelineTeamLabels,
} from "~/types/coach";
import { CLUSTER_TIME_WINDOW_SECONDS } from "~/utils/deathClustering";

export interface MatchTimelinePlayer {
  battletag: string;
  team: number;
  /** Hero display name when the caller resolved it; lanes fall back to the battletag. */
  heroName?: string | null;
}

/** Everything the chronology needs from one match -- kept decoupled from
 * MatchDetailResponse's wire shape so the derivation stays testable
 * without a fetch. */
export interface MatchTimelineInput {
  timeline: MatchTimelineData | null;
  players: MatchTimelinePlayer[];
  durationSeconds: number;
  /** Every BattleTag the viewer owns, so their lane is identifiable; empty when the viewer isn't in the match. */
  myBattletags?: string[];
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** One team's mean level per distinct snapshot timestamp, ascending. */
function levelSteps(snapshots: { atSeconds: number; level: number }[]): MatchTimelineLevelStep[] {
  const levelsByTime = new Map<number, number[]>();
  for (const snapshot of snapshots) {
    const levels = levelsByTime.get(snapshot.atSeconds);
    if (levels) levels.push(snapshot.level);
    else levelsByTime.set(snapshot.atSeconds, [snapshot.level]);
  }
  return [...levelsByTime.entries()]
    .map(([atSeconds, levels]) => ({ atSeconds, level: mean(levels) }))
    .sort((a, b) => a.atSeconds - b.atSeconds);
}

/**
 * Clusters one team's death timestamps. The spatial clustering
 * (utils/deathClustering.ts) needs coordinates; the chronology does not, so
 * this is time-only. Single-linkage in 1D is a contiguous run whose
 * consecutive gap stays within the window, so a sorted scan is exact.
 */
function clusterDeathTimes(atSeconds: number[]): { atSeconds: number; deaths: number }[] {
  const sorted = [...atSeconds].sort((a, b) => a - b);
  const clusters: { atSeconds: number; deaths: number }[] = [];
  let members: number[] = [];
  for (const time of sorted) {
    if (members.length > 0 && time - members[members.length - 1]! > CLUSTER_TIME_WINDOW_SECONDS) {
      clusters.push({ atSeconds: mean(members), deaths: members.length });
      members = [];
    }
    members.push(time);
  }
  if (members.length > 0) clusters.push({ atSeconds: mean(members), deaths: members.length });
  return clusters;
}

/**
 * Pure C2 derivation. The lead curve is the two teams' mean snapshot level
 * over time, each team's last known level carried forward between its own
 * level-ups -- never an interpolated or invented point. A point exists only
 * once both teams have a known level, and hasLevelData is true only when at
 * least one such point exists (acceptance criterion 1).
 */
export function buildMatchTimelineSeries(input: MatchTimelineInput): MatchTimelineSeries {
  const timeline = input.timeline;
  if (!timeline) {
    return {
      hasLevelData: false,
      points: [],
      finalLead: null,
      teamLevels: [[], []],
      deaths: [],
      structures: [],
      objectives: [],
      lanes: [],
      allDeaths: [],
      events: [],
    };
  }

  const teamByBattletag = new Map(input.players.map((player) => [player.battletag, player.team]));
  const heroByBattletag = new Map(input.players.map((player) => [player.battletag, player.heroName ?? null]));
  const snapshotsByTeam: { atSeconds: number; level: number }[][] = [[], []];
  for (const snapshot of timeline.levelSnapshots) {
    const team = teamByBattletag.get(snapshot.battletag);
    if (team !== 0 && team !== 1) continue;
    snapshotsByTeam[team]!.push({ atSeconds: snapshot.atSeconds, level: snapshot.level });
  }
  const steps = [levelSteps(snapshotsByTeam[0]!), levelSteps(snapshotsByTeam[1]!)];
  const teamLevels: [MatchTimelineLevelStep[], MatchTimelineLevelStep[]] = [steps[0]!, steps[1]!];

  const timestamps = [
    ...new Set([...steps[0]!.map((step) => step.atSeconds), ...steps[1]!.map((step) => step.atSeconds)]),
  ].sort((a, b) => a - b);

  const points: MatchTimelineLeadPoint[] = [];
  const cursors = [0, 0];
  const latest: (number | null)[] = [null, null];
  for (const atSeconds of timestamps) {
    for (const team of [0, 1] as const) {
      const teamSteps = steps[team]!;
      while (cursors[team]! < teamSteps.length && teamSteps[cursors[team]!]!.atSeconds <= atSeconds) {
        latest[team] = teamSteps[cursors[team]!]!.level;
        cursors[team]! += 1;
      }
    }
    if (latest[0] === null || latest[0] === undefined || latest[1] === null || latest[1] === undefined) continue;
    points.push({ atSeconds, team0Level: latest[0], team1Level: latest[1], lead: latest[0] - latest[1] });
  }

  const deaths: MatchTimelineDeathMarker[] = [];
  for (const team of [0, 1] as const) {
    for (const cluster of clusterDeathTimes(
      timeline.deaths.filter((death) => death.team === team).map((death) => death.atSeconds),
    )) {
      deaths.push({ team, atSeconds: cluster.atSeconds, deaths: cluster.deaths });
    }
  }
  deaths.sort((a, b) => a.atSeconds - b.atSeconds);

  const structures: MatchTimelineStructureEvent[] = [...(timeline.structureEvents ?? [])].sort(
    (a, b) => a.atSeconds - b.atSeconds,
  );

  // One lane per player, so the chronology can show everyone's own deaths
  // rather than only a per-team aggregate. Deaths (and their killers) are
  // resolved to hero names here, once, instead of in each render pass.
  const mine = new Set(input.myBattletags ?? []);
  const laneByBattletag = new Map<string, MatchTimelineLane>();
  for (const player of input.players) {
    if (player.team !== 0 && player.team !== 1) continue;
    laneByBattletag.set(player.battletag, {
      battletag: player.battletag,
      heroName: player.heroName ?? null,
      team: player.team,
      isMe: mine.has(player.battletag),
      deaths: [],
    });
  }

  const allDeaths: MatchTimelineStateDeath[] = [];
  for (const death of timeline.deaths) {
    const killers = [...(death.killers ?? [])];
    const resolved: MatchTimelineStateDeath = {
      battletag: death.battletag,
      heroName: heroByBattletag.get(death.battletag) ?? null,
      team: death.team,
      atSeconds: death.atSeconds,
      killers,
      killerNames: killers.map((killer) => heroByBattletag.get(killer) ?? killer),
      killType: death.killType ?? null,
    };
    allDeaths.push(resolved);
    laneByBattletag
      .get(death.battletag)
      ?.deaths.push({ atSeconds: death.atSeconds, killers: resolved.killers, killType: resolved.killType });
  }
  allDeaths.sort((a, b) => a.atSeconds - b.atSeconds);

  const lanes = [...laneByBattletag.values()];
  const myTeam = lanes.find((lane) => lane.isMe)?.team ?? null;
  for (const lane of lanes) lane.deaths.sort((a, b) => a.atSeconds - b.atSeconds);
  // My lane first, then my team, then the enemy team; within a group the
  // busiest players lead, so a lane that matters is never buried.
  const groupRank = (lane: MatchTimelineLane): number =>
    lane.isMe ? 0 : myTeam === null ? 1 : lane.team === myTeam ? 1 : 2;
  lanes.sort(
    (a, b) =>
      groupRank(a) - groupRank(b) ||
      b.deaths.length - a.deaths.length ||
      a.battletag.localeCompare(b.battletag),
  );

  const events: MatchTimelineEvent[] = [
    ...allDeaths.map(
      (death): MatchTimelineEvent => ({
        kind: "death",
        atSeconds: death.atSeconds,
        team: death.team,
        battletag: death.battletag,
        heroName: death.heroName,
      }),
    ),
    ...structures.map(
      (structure): MatchTimelineEvent => ({
        kind: "structure",
        atSeconds: structure.atSeconds,
        team: structure.team,
        structureType: structure.structureType,
      }),
    ),
  ];
  events.sort((a, b) => a.atSeconds - b.atSeconds || (a.kind === b.kind ? 0 : a.kind === "death" ? -1 : 1));

  const objectives = [...(timeline.objectives ?? [])].sort((a, b) => a.atSeconds - b.atSeconds);

  return {
    hasLevelData: points.length > 0,
    points,
    finalLead: points.length > 0 ? points[points.length - 1]!.lead : null,
    teamLevels,
    deaths,
    structures,
    objectives,
    lanes,
    allDeaths,
    events,
  };
}

/**
 * French labels for the two sides. The viewer's own team is only knowable
 * when the match page resolved it (the viewer is in the match); otherwise
 * neutral team numbers avoid pretending to know whose side each is.
 */
export function timelineTeamLabels(allyTeam: 0 | 1 | null): MatchTimelineTeamLabels {
  if (allyTeam === 0) return { team0: "mon équipe", team1: "les adversaires" };
  if (allyTeam === 1) return { team0: "les adversaires", team1: "mon équipe" };
  return { team0: "l'équipe 1", team1: "l'équipe 2" };
}

/** Levels are integers in practice, but the mean of several snapshots at one
 * timestamp can land on .5 -- show it rather than round a real difference away. */
export function formatTimelineLevel(level: number): string {
  return Number.isInteger(level) ? String(level) : level.toFixed(1);
}

/**
 * The chart's text alternative (acceptance criterion 3): it names the side
 * ahead and by how much at the last shared snapshot. Deliberately avoids
 * verb agreement traps ("mon équipe" / "les adversaires" cannot both take
 * the same verb), so it stays correct whichever side leads.
 */
export function buildMatchTimelineSummary(series: MatchTimelineSeries, labels: MatchTimelineTeamLabels): string {
  if (series.points.length === 0 || series.finalLead === null) {
    return "Chronologie indisponible : aucune donnée de niveau comparable.";
  }
  const last = series.points[series.points.length - 1]!;
  const level0 = formatTimelineLevel(last.team0Level);
  const level1 = formatTimelineLevel(last.team1Level);
  const lead = series.finalLead;
  if (lead > 0) {
    return (
      "Niveau final : " + level0 + " – " + level1 + ", " + labels.team0 + " devant " + labels.team1 +
      " (avance de " + formatTimelineLevel(lead) + (lead > 1 ? " niveaux)." : " niveau).")
    );
  }
  if (lead < 0) {
    const gap = Math.abs(lead);
    return (
      "Niveau final : " + level1 + " – " + level0 + ", " + labels.team1 + " devant " + labels.team0 +
      " (avance de " + formatTimelineLevel(gap) + (gap > 1 ? " niveaux)." : " niveau).")
    );
  }
  return "Niveau final : égalité " + level0 + " – " + level1 + ".";
}

/** Maps atSeconds onto [0, width], clamped -- a duration of 0 maps everything to 0. */
export function timelineX(atSeconds: number, durationSeconds: number, width: number): number {
  if (durationSeconds <= 0) return 0;
  return Math.min(width, Math.max(0, (atSeconds / durationSeconds) * width));
}

/** Symmetric lead domain from the series, with a 1-level floor so a 0.5 lead is not stretched. */
export function timelineLeadMax(points: MatchTimelineLeadPoint[]): number {
  return Math.max(1, ...points.map((point) => Math.abs(point.lead)));
}

/** Maps a lead onto a symmetric y domain: 0 -> midY, +/-leadMax -> topY/bottomY, clamped. */
export function timelineLeadY(lead: number, leadMax: number, midY: number, halfHeight: number): number {
  if (leadMax <= 0) return midY;
  const clamped = Math.min(leadMax, Math.max(-leadMax, lead));
  return midY - (clamped / leadMax) * halfHeight;
}

const DEATH_MARKER_BASE_RADIUS = 3;
const DEATH_MARKER_RADIUS_STEP = 1.5;
const DEATH_MARKER_MAX_RADIUS = 10;

/** Death-marker radius: one step per extra death in the cluster, capped so a huge teamfight stays on its track. */
export function deathMarkerRadius(deaths: number): number {
  return Math.min(DEATH_MARKER_MAX_RADIUS, DEATH_MARKER_BASE_RADIUS + Math.max(0, deaths - 1) * DEATH_MARKER_RADIUS_STEP);
}

/** A team's last known level at or before `seconds`, read off its own steps.
 * Null before that team's first snapshot: the parser only records real
 * level-ups, so "unknown" is the honest answer rather than level 1. */
export function timelineLevelAt(steps: MatchTimelineLevelStep[], seconds: number): number | null {
  let level: number | null = null;
  for (const step of steps) {
    if (step.atSeconds > seconds) break;
    level = step.level;
  }
  return level;
}

/** The state of the game at one instant: both teams' carried-forward level,
 * the resulting lead, and the events within `windowSeconds`. */
export function timelineStateAt(
  series: MatchTimelineSeries,
  seconds: number,
  windowSeconds = CLUSTER_TIME_WINDOW_SECONDS,
): MatchTimelineStateAt {
  const team0Level = timelineLevelAt(series.teamLevels[0], seconds);
  const team1Level = timelineLevelAt(series.teamLevels[1], seconds);
  return {
    atSeconds: seconds,
    team0Level,
    team1Level,
    lead: team0Level === null || team1Level === null ? null : team0Level - team1Level,
    deaths: series.allDeaths.filter((death) => Math.abs(death.atSeconds - seconds) <= windowSeconds),
    structures: series.structures.filter((structure) => Math.abs(structure.atSeconds - seconds) <= windowSeconds),
  };
}

/** The death under the cursor (nearest within the clustering window) and the
 * rest of its fight. Null when the cursor isn't sitting on a death -- the
 * detail panel then shows the level state alone. Ties go to the earlier
 * death so the same cursor position always answers the same way. */
export function timelineFocusAt(
  series: MatchTimelineSeries,
  seconds: number,
  windowSeconds = CLUSTER_TIME_WINDOW_SECONDS,
): MatchTimelineFocus | null {
  let victim: MatchTimelineStateDeath | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const death of series.allDeaths) {
    const distance = Math.abs(death.atSeconds - seconds);
    if (distance > windowSeconds || distance >= best) continue;
    best = distance;
    victim = death;
  }
  if (victim === null) return null;
  const atSeconds = victim.atSeconds;
  return {
    victim,
    fight: series.allDeaths.filter((death) => Math.abs(death.atSeconds - atSeconds) <= windowSeconds),
  };
}

/** The next (direction 1) or previous (direction -1) event in time, strictly
 * after/before `seconds` so stepping from an event lands on its neighbour. */
export function timelineEventStep(
  events: MatchTimelineEvent[],
  seconds: number,
  direction: -1 | 1,
): MatchTimelineEvent | null {
  if (direction > 0) return events.find((event) => event.atSeconds > seconds) ?? null;
  let previous: MatchTimelineEvent | null = null;
  for (const event of events) {
    if (event.atSeconds >= seconds) break;
    previous = event;
  }
  return previous;
}

export interface MatchTimelineSurroundings {
  previous: MatchTimelineEvent | null;
  upcoming: MatchTimelineEvent[];
}

/** The last event at or before the cursor plus the next `upcomingLimit` ones
 * after it -- the "autour de cet instant" rail. */
export function timelineEventsAround(
  events: MatchTimelineEvent[],
  seconds: number,
  upcomingLimit = 3,
): MatchTimelineSurroundings {
  let previous: MatchTimelineEvent | null = null;
  const upcoming: MatchTimelineEvent[] = [];
  for (const event of events) {
    if (event.atSeconds <= seconds) {
      previous = event;
      continue;
    }
    if (upcoming.length >= upcomingLimit) break;
    upcoming.push(event);
  }
  return { previous, upcoming };
}

const STRUCTURE_LABELS: Record<NonNullable<MatchTimelineEvent["structureType"]>, string> = {
  core: "Cœur",
  bastion: "Bastion",
  tower: "Tour",
  gate: "Porte",
};

/** French name of a destroyed structure, matching the game's own wording. */
export function structureTypeLabel(structureType: NonNullable<MatchTimelineEvent["structureType"]>): string {
  return STRUCTURE_LABELS[structureType];
}

/** One-line label for an event, shared by the rail and the hover card so both
 * name the same thing the same way. */
export function timelineEventLabel(event: MatchTimelineEvent): string {
  if (event.kind === "structure") {
    const name = event.structureType ? structureTypeLabel(event.structureType) : "Structure";
    return name + " détruit";
  }
  return "Mort de " + (event.heroName ?? event.battletag ?? "un joueur");
}

export interface UseMatchTimelineSeriesResult {
  series: ComputedRef<MatchTimelineSeries>;
  durationSeconds: ComputedRef<number>;
  /** 0-100, the scrubber's own scale (a native range input's value). */
  scrubPercent: Ref<number>;
  /** Writable: the page shares this with the heatmap tab's highlightAtSeconds. */
  scrubSeconds: WritableComputedRef<number>;
}

/**
 * Reactive wrapper around the pure derivation plus the C2 scrubber state.
 * scrubSeconds is writable so the match page can bind it with
 * v-model:scrub-seconds and pass the same value to the heatmap tab.
 */
export function useMatchTimelineSeries(input: ComputedRef<MatchTimelineInput>): UseMatchTimelineSeriesResult {
  const series = computed(() => buildMatchTimelineSeries(input.value));
  const scrubPercent = ref(100);
  const durationSeconds = computed(() => Math.max(0, input.value.durationSeconds));
  const scrubSeconds = computed({
    get: () => (scrubPercent.value / 100) * durationSeconds.value,
    set: (value: number) => {
      scrubPercent.value =
        durationSeconds.value > 0 ? Math.min(100, Math.max(0, (value / durationSeconds.value) * 100)) : 0;
    },
  });
  return { series, durationSeconds, scrubPercent, scrubSeconds };
}

/**
 * French label for the lead at one instant -- shared by the detail panel and
 * the chart's hover card so both name the same gap the same way. Deliberately
 * avoids verb agreement traps ("mon equipe" / "les adversaires" cannot both
 * take the same verb), the same reason `buildMatchTimelineSummary` does.
 */
export function timelineLeadLabel(lead: number | null, labels: MatchTimelineTeamLabels): string | null {
  if (lead === null) return null;
  if (lead === 0) return "égalité";
  const ahead = lead > 0 ? labels.team0 : labels.team1;
  const gap = formatTimelineLevel(Math.abs(lead));
  return ahead + " devant de " + gap + (Math.abs(lead) > 1 ? " niveaux" : " niveau");
}

export interface TimelineStructureLane {
  team: 0 | 1;
  /** "ally" is the row drawn first: the viewer's own team when known. */
  side: "ally" | "enemy";
  /** Row label, drawn left of the track. */
  label: string;
}

/**
 * The two rows of the chronology's structure band: the viewer's own team
 * first, the other second, so "nos structures" always sits above "leurs
 * structures". Without a viewer team the rows keep the neutral team-number
 * labels instead of pretending to know which side is whose.
 */
export function timelineStructureLanes(
  allyTeam: 0 | 1 | null,
  labels: MatchTimelineTeamLabels,
): [TimelineStructureLane, TimelineStructureLane] {
  if (allyTeam === null) {
    return [
      { team: 0, side: "ally", label: labels.team0 },
      { team: 1, side: "enemy", label: labels.team1 },
    ];
  }
  const enemyTeam: 0 | 1 = allyTeam === 0 ? 1 : 0;
  return [
    { team: allyTeam, side: "ally", label: "nos structures" },
    { team: enemyTeam, side: "enemy", label: "leurs structures" },
  ];
}

/** How one destroyed structure's side reads in a tooltip or a list. */
export function timelineStructureSideLabel(team: 0 | 1, allyTeam: 0 | 1 | null): string {
  if (allyTeam === null) return team === 0 ? "équipe 1" : "équipe 2";
  return team === allyTeam ? "notre structure" : "leur structure";
}

export interface MatchTimelineStructureMarker {
  /** Unique even when two structures of the same type fall on the same second. */
  key: string;
  team: 0 | 1;
  atSeconds: number;
  structureType: NonNullable<MatchTimelineEvent["structureType"]>;
  /** Horizontal slot inside a same-team, same-second group: 0 when alone,
   * otherwise symmetric around 0 (-0.5/+0.5 for a pair, -1/0/1 for a trio) so
   * simultaneous destructions never draw on top of each other. */
  slot: number;
}

/**
 * The structure squares inside the visible window, each tagged with its slot.
 * Grouping is per team and per second: an allied keep and an enemy fort on the
 * same second still each sit on their own row, while two allied walls of the
 * same wave get separate slots. Keys are unique by construction -- the
 * previous `team-type-second` key silently collapsed simultaneous
 * destructions into one square when Vue de-duplicated the v-for.
 */
export function timelineStructureMarkers(
  structures: MatchTimelineStructureEvent[],
  window?: { startSeconds: number; endSeconds: number },
): MatchTimelineStructureMarker[] {
  const visible = window
    ? structures.filter(
        (event) => event.atSeconds >= window.startSeconds && event.atSeconds <= window.endSeconds,
      )
    : structures;
  const groups = new Map<string, MatchTimelineStructureEvent[]>();
  for (const event of visible) {
    const groupKey = event.team + "@" + event.atSeconds;
    const group = groups.get(groupKey);
    if (group) group.push(event);
    else groups.set(groupKey, [event]);
  }
  const markers: MatchTimelineStructureMarker[] = [];
  for (const [groupKey, group] of groups) {
    group.forEach((event, index) => {
      markers.push({
        key: groupKey + "-" + event.structureType + "-" + index,
        team: event.team,
        atSeconds: event.atSeconds,
        structureType: event.structureType,
        slot: index - (group.length - 1) / 2,
      });
    });
  }
  markers.sort((a, b) => a.atSeconds - b.atSeconds || a.team - b.team || a.slot - b.slot);
  return markers;
}

export interface TimelineComparisonRow {
  team: 0 | 1;
  label: string;
  level: number | null;
}

export interface TimelineComparison {
  atSeconds: number;
  /** Team 0 first, team 1 second -- the chart's own team order. */
  rows: [TimelineComparisonRow, TimelineComparisonRow];
  /** team0Level - team1Level; null until both sides have a known level. */
  lead: number | null;
  /** French one-liner naming the side ahead; null when the lead is unknown. */
  leadLabel: string | null;
  /** The team ahead; null on a tie or an unknown lead. */
  leader: 0 | 1 | null;
  /** The same carried-forward instant `timelineStateAt` answers, so the hover
   * card and the panel beside it can never disagree. */
  deaths: MatchTimelineStateDeath[];
  structures: MatchTimelineStructureEvent[];
}

/**
 * Everything the chart's hover card shows for one instant: both teams' levels
 * and who is ahead, plus the events within the clustering window of the
 * cursor. Built on `timelineStateAt`, never a second, drifting derivation.
 */
export function timelineComparison(
  series: MatchTimelineSeries,
  seconds: number,
  labels: MatchTimelineTeamLabels,
): TimelineComparison {
  const state = timelineStateAt(series, seconds);
  return {
    atSeconds: state.atSeconds,
    rows: [
      { team: 0, label: labels.team0, level: state.team0Level },
      { team: 1, label: labels.team1, level: state.team1Level },
    ],
    lead: state.lead,
    leadLabel: timelineLeadLabel(state.lead, labels),
    leader: state.lead === null || state.lead === 0 ? null : state.lead > 0 ? 0 : 1,
    deaths: state.deaths,
    structures: state.structures,
  };
}

