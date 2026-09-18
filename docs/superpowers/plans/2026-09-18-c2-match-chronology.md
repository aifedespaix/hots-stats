# C2 - Match Chronology Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a third tab, Chronologie, to apps/web/app/pages/matches/[id].vue: a team level-lead curve from timeline.levelSnapshots, death markers per team, best-effort structure markers, and a scrubber that highlights the same moment on the existing heatmap tab.

**Architecture:** No API or database change. GET /matches/:id already returns timeline.levelSnapshots ({ battletag, atSeconds, level }, team mapped via the match players), timeline.deaths ({ battletag, team, atSeconds, ... }) and timeline.structureEvents ({ team, atSeconds, structureType }). All derivation lives in one pure, vue-only module (apps/web/app/composables/useMatchTimelineSeries.ts, no Nuxt runtime) so it is unit-testable under plain vitest, exactly like useHeatmapSync.ts. MatchTimelineChart.vue is a hand-rolled SVG (same choice as SparklineTile/sparkline.ts: precise marker + scrubber control, no new dependency). The scrub position is a page-level ref shared with SpatialSlotGroup via an optional highlightAtSeconds prop threaded down to SpatialMarkerLayer, so the heatmap tab emphasises the death clusters near the scrubbed time.

**Tech Stack:** Nuxt 4 / Vue 3 (script setup), Nuxt UI, hand-rolled SVG, vitest (web). No new dependency.

**Spec:** docs/superpowers/specs/2026-09-18-player-progression-design.md section C2 (lines 563-588).

## Global Constraints

- UI copy in French, identifiers/comments in English (repo rule).
- No invented data: the curve only joins real snapshots (carry-forward between them), never an interpolated/fabricated timeline; levels are the two teams' mean snapshot level, x is the real atSeconds; a match without snapshots shows an explicit state, not an empty chart.
- No new dependency, no API/DB/migration change, no change to the existing two tabs' behaviour.
- Empty and error states use UiStateCard / UiErrorState.
- Tests live next to the code (*.test.ts) and run with bun run --filter './apps/web' test.
- The scrubber must be keyboard operable (a native input[type=range]), and the chart must expose a text alternative summarising the final lead (acceptance criteria 1-3).

## File Structure

- Modify: apps/web/app/types/coach.ts -- add the MatchTimelineLeadPoint / MatchTimelineDeathMarker / MatchTimelineSeries / MatchTimelineTeamLabels contracts.
- Create: apps/web/app/composables/useMatchTimelineSeries.ts -- pure series derivation, summary text, SVG geometry helpers, and the reactive composable (scrub ref).
- Create: apps/web/app/composables/useMatchTimelineSeries.test.ts -- acceptance criteria 2 (curve from the two teams' snapshots, no fabrication) plus the summary/geometry rules.
- Modify: apps/web/app/utils/deathClustering.ts -- HIGHLIGHT_WINDOW_SECONDS + isClusterHighlighted (the one pure rule behind the heatmap highlight).
- Modify: apps/web/app/utils/deathClustering.test.ts -- tests for isClusterHighlighted.
- Create: apps/web/app/components/charts/MatchTimelineChart.vue -- SVG curve + markers + scrubber + text alternative + "donnees de niveau absentes" state (acceptance criteria 1 and 3).
- Modify: apps/web/app/components/spatial/SpatialMarkerLayer.vue, SpatialHeatmapView.vue, SpatialSlotGroup.vue -- optional highlightAtSeconds pass-through (additive; default null = today's behaviour).
- Modify: apps/web/app/pages/matches/[id].vue -- third tab, viewer-team derivation, scrub wiring to the heatmap tab.

**Deviation from the spec's file list (to be documented at commit time):** the spec lists only MatchTimelineChart.vue, useMatchTimelineSeries.ts and matches/[id].vue / types/coach.ts. The pure derivation lives in useMatchTimelineSeries.ts and is tested by useMatchTimelineSeries.test.ts (same pure-module split as A1/A3/A4/C1: a component is not unit-testable under the plain vitest config). The scrubber-to-heatmap bullet needs the optional highlightAtSeconds prop threaded through the three existing spatial components; it is strictly additive (absent prop = current rendering) and deathClustering.ts gains the one pure rule it needs.

---

### Task 1: Timeline wire types and pure lead curve

**Files:**
- Modify: apps/web/app/types/coach.ts
- Create: apps/web/app/composables/useMatchTimelineSeries.ts
- Test: apps/web/app/composables/useMatchTimelineSeries.test.ts

**Interfaces:**
- Consumes: MatchTimelineData (existing), CLUSTER_TIME_WINDOW_SECONDS from ~/utils/deathClustering.
- Produces:
  - MatchTimelineLeadPoint { atSeconds: number; team0Level: number; team1Level: number; lead: number }
  - MatchTimelineDeathMarker { team: 0 | 1; atSeconds: number; deaths: number }
  - MatchTimelineSeries { hasLevelData: boolean; points: MatchTimelineLeadPoint[]; finalLead: number | null; deaths: MatchTimelineDeathMarker[]; structures: MatchTimelineStructureEvent[] }
  - MatchTimelinePlayer { battletag: string; team: number }
  - MatchTimelineInput { timeline: MatchTimelineData | null; players: MatchTimelinePlayer[]; durationSeconds: number }
  - buildMatchTimelineSeries(input: MatchTimelineInput): MatchTimelineSeries

- [ ] **Step 1: Add the shared timeline types**

Append to apps/web/app/types/coach.ts (after MatchTimelineData):

    /** One point of the C2 chronology lead curve: both teams' mean level at
     * atSeconds (HotS levels are shared team-wide, so several snapshots at the
     * same timestamp are averaged) and their difference. */
    export interface MatchTimelineLeadPoint {
      atSeconds: number;
      team0Level: number;
      team1Level: number;
      /** team0Level - team1Level; positive = team 0 ahead. */
      lead: number;
    }

    /** One death cluster on the chronology: one team's deaths within
     * CLUSTER_TIME_WINDOW_SECONDS of each other, collapsed into one marker
     * sized by deaths. Time-only (unlike SpatialEventCluster): a death with
     * no x/y still belongs on a chronology. */
    export interface MatchTimelineDeathMarker {
      team: 0 | 1;
      /** Mean timestamp of the cluster's deaths. */
      atSeconds: number;
      deaths: number;
    }

    /** Everything MatchTimelineChart.vue draws for one match, derived only
     * from MatchTimelineData (no fabricated timeline). */
    export interface MatchTimelineSeries {
      /** True only when both teams share a level snapshot in time; false makes
       * the tab show an explicit "donnees de niveau absentes" state instead of
       * an empty chart. */
      hasLevelData: boolean;
      /** Lead curve, ascending by atSeconds. */
      points: MatchTimelineLeadPoint[];
      /** Lead at the last shared snapshot; null when there is no point. */
      finalLead: number | null;
      deaths: MatchTimelineDeathMarker[];
      structures: MatchTimelineStructureEvent[];
    }

    /** French labels for the two sides, so the text alternative can name the
     * viewer's team instead of "equipe 0". */
    export interface MatchTimelineTeamLabels {
      team0: string;
      team1: string;
    }

- [ ] **Step 2: Write the failing test**

Create apps/web/app/composables/useMatchTimelineSeries.test.ts:

    import { describe, expect, it } from "vitest";
    import type { MatchTimelineData } from "~/types/coach";
    import { buildMatchTimelineSeries, type MatchTimelineInput } from "./useMatchTimelineSeries";

    function timeline(overrides: Partial<MatchTimelineData> = {}): MatchTimelineData {
      return { deaths: [], levelSnapshots: [], ...overrides };
    }

    function input(overrides: Partial<MatchTimelineInput> = {}): MatchTimelineInput {
      return {
        timeline: timeline(),
        players: [
          { battletag: "A#1", team: 0 },
          { battletag: "A#2", team: 0 },
          { battletag: "B#1", team: 1 },
        ],
        durationSeconds: 300,
        ...overrides,
      };
    }

    describe("buildMatchTimelineSeries lead curve", () => {
      it("has no level data when the match has no timeline", () => {
        const series = buildMatchTimelineSeries(input({ timeline: null }));
        expect(series.hasLevelData).toBe(false);
        expect(series.points).toEqual([]);
        expect(series.finalLead).toBeNull();
        expect(series.deaths).toEqual([]);
        expect(series.structures).toEqual([]);
      });

      it("has no level data when neither team has a level snapshot", () => {
        const series = buildMatchTimelineSeries(input());
        expect(series.hasLevelData).toBe(false);
      });

      it("carries each team's last known level forward between snapshots", () => {
        const series = buildMatchTimelineSeries(
          input({
            timeline: timeline({
              levelSnapshots: [
                { battletag: "A#1", atSeconds: 60, level: 2 },
                { battletag: "A#1", atSeconds: 120, level: 3 },
                { battletag: "B#1", atSeconds: 90, level: 2 },
                { battletag: "B#1", atSeconds: 150, level: 4 },
              ],
            }),
          }),
        );
        // t=60 has no team-1 level yet -> no point; t=90/120/150 both known.
        expect(series.points).toEqual([
          { atSeconds: 90, team0Level: 2, team1Level: 2, lead: 0 },
          { atSeconds: 120, team0Level: 3, team1Level: 2, lead: 1 },
          { atSeconds: 150, team0Level: 3, team1Level: 4, lead: -1 },
        ]);
        expect(series.finalLead).toBe(-1);
        expect(series.hasLevelData).toBe(true);
      });

      it("averages several snapshots from the same team at one timestamp", () => {
        const series = buildMatchTimelineSeries(
          input({
            timeline: timeline({
              levelSnapshots: [
                { battletag: "A#1", atSeconds: 60, level: 2 },
                { battletag: "A#2", atSeconds: 60, level: 4 },
                { battletag: "B#1", atSeconds: 60, level: 3 },
              ],
            }),
          }),
        );
        expect(series.points).toEqual([{ atSeconds: 60, team0Level: 3, team1Level: 3, lead: 0 }]);
      });

      it("ignores snapshots from battletags that are not in the match", () => {
        const series = buildMatchTimelineSeries(
          input({
            timeline: timeline({ levelSnapshots: [{ battletag: "Ghost#9", atSeconds: 10, level: 5 }] }),
          }),
        );
        expect(series.points).toEqual([]);
        expect(series.hasLevelData).toBe(false);
      });
    });

    describe("buildMatchTimelineSeries markers", () => {
      it("clusters each team's deaths by time and sizes the marker by the cluster", () => {
        const series = buildMatchTimelineSeries(
          input({
            timeline: timeline({
              deaths: [
                { battletag: "A#1", team: 0, atSeconds: 100 },
                { battletag: "A#2", team: 0, atSeconds: 104 },
                { battletag: "A#1", team: 0, atSeconds: 300 },
                { battletag: "B#1", team: 1, atSeconds: 150 },
              ],
            }),
          }),
        );
        expect(series.deaths).toEqual([
          { team: 0, atSeconds: 102, deaths: 2 },
          { team: 1, atSeconds: 150, deaths: 1 },
          { team: 0, atSeconds: 300, deaths: 1 },
        ]);
        expect(series.hasLevelData).toBe(false);
      });

      it("keeps structure events sorted by time, best-effort as ingested", () => {
        const series = buildMatchTimelineSeries(
          input({
            timeline: timeline({
              structureEvents: [
                { team: 1, atSeconds: 60, structureType: "fort" },
                { team: 0, atSeconds: 30, structureType: "keep" },
              ],
            }),
          }),
        );
        expect(series.structures).toEqual([
          { team: 0, atSeconds: 30, structureType: "keep" },
          { team: 1, atSeconds: 60, structureType: "fort" },
        ]);
      });
    });

- [ ] **Step 3: Run the test to verify it fails**

Run: bun run --filter './apps/web' test app/composables/useMatchTimelineSeries.test.ts
Expected: FAIL -- cannot resolve ./useMatchTimelineSeries.

- [ ] **Step 4: Write the minimal implementation**

Create apps/web/app/composables/useMatchTimelineSeries.ts:

    // Explicit vue import (not Nuxt auto-import) so the pure logic is
    // testable with plain vitest -- see useHeatmapSync.ts's own comment, the
    // repo's precedent for this split.
    import { computed, type ComputedRef, type Ref, type WritableComputedRef, ref } from "vue";
    import type {
      MatchTimelineData,
      MatchTimelineDeathMarker,
      MatchTimelineLeadPoint,
      MatchTimelineSeries,
      MatchTimelineStructureEvent,
      MatchTimelineTeamLabels,
    } from "~/types/coach";
    import { CLUSTER_TIME_WINDOW_SECONDS } from "~/utils/deathClustering";

    export interface MatchTimelinePlayer {
      battletag: string;
      team: number;
    }

    /** Everything the chronology needs from one match -- kept decoupled from
     * MatchDetailResponse's wire shape so the derivation stays testable
     * without a fetch. */
    export interface MatchTimelineInput {
      timeline: MatchTimelineData | null;
      players: MatchTimelinePlayer[];
      durationSeconds: number;
    }

    function mean(values: number[]): number {
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    /** One team's mean level per distinct snapshot timestamp, ascending. */
    function levelSteps(snapshots: { atSeconds: number; level: number }[]): { atSeconds: number; level: number }[] {
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
     * (utils/deathClustering.ts) needs coordinates; the chronology does not,
     * so this is time-only. Single-linkage in 1D is a contiguous run whose
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
     * level-ups -- never an interpolated or invented point. A point exists
     * only once both teams have a known level, and hasLevelData is true only
     * when at least one such point exists (acceptance criterion 1).
     */
    export function buildMatchTimelineSeries(input: MatchTimelineInput): MatchTimelineSeries {
      const timeline = input.timeline;
      if (!timeline) {
        return { hasLevelData: false, points: [], finalLead: null, deaths: [], structures: [] };
      }

      const teamByBattletag = new Map(input.players.map((player) => [player.battletag, player.team]));
      const snapshotsByTeam: { atSeconds: number; level: number }[][] = [[], []];
      for (const snapshot of timeline.levelSnapshots) {
        const team = teamByBattletag.get(snapshot.battletag);
        if (team !== 0 && team !== 1) continue;
        snapshotsByTeam[team]!.push({ atSeconds: snapshot.atSeconds, level: snapshot.level });
      }
      const steps = [levelSteps(snapshotsByTeam[0]!), levelSteps(snapshotsByTeam[1]!)];

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
        if (latest[0] === null || latest[1] === null) continue;
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

      return {
        hasLevelData: points.length > 0,
        points,
        finalLead: points.length > 0 ? points[points.length - 1]!.lead : null,
        deaths,
        structures,
      };
    }

- [ ] **Step 5: Run the test to verify it passes**

Run: bun run --filter './apps/web' test app/composables/useMatchTimelineSeries.test.ts
Expected: PASS.

- [ ] **Step 6: Commit**

    git add apps/web/app/types/coach.ts apps/web/app/composables/useMatchTimelineSeries.ts apps/web/app/composables/useMatchTimelineSeries.test.ts
    git commit -m "feat(web): derive the C2 match chronology series from the replay timeline"

---

### Task 2: Text alternative and SVG geometry helpers

**Files:**
- Modify: apps/web/app/composables/useMatchTimelineSeries.ts
- Test: apps/web/app/composables/useMatchTimelineSeries.test.ts

**Interfaces:**
- Consumes: MatchTimelineLeadPoint, MatchTimelineSeries, MatchTimelineTeamLabels.
- Produces:
  - timelineTeamLabels(allyTeam: 0 | 1 | null): MatchTimelineTeamLabels
  - formatTimelineLevel(level: number): string
  - buildMatchTimelineSummary(series: MatchTimelineSeries, labels: MatchTimelineTeamLabels): string
  - timelineX(atSeconds: number, durationSeconds: number, width: number): number
  - timelineLeadMax(points: MatchTimelineLeadPoint[]): number
  - timelineLeadY(lead: number, leadMax: number, midY: number, halfHeight: number): number
  - deathMarkerRadius(deaths: number): number

- [ ] **Step 1: Write the failing tests**

Append to apps/web/app/composables/useMatchTimelineSeries.test.ts (add the new names to the existing import from ./useMatchTimelineSeries):

    import {
      buildMatchTimelineSeries,
      buildMatchTimelineSummary,
      deathMarkerRadius,
      formatTimelineLevel,
      timelineLeadMax,
      timelineLeadY,
      timelineTeamLabels,
      timelineX,
      type MatchTimelineInput,
    } from "./useMatchTimelineSeries";
    import type { MatchTimelineSeries } from "~/types/coach";

    function series(overrides: Partial<MatchTimelineSeries> = {}): MatchTimelineSeries {
      return { hasLevelData: true, points: [], finalLead: null, deaths: [], structures: [], ...overrides };
    }

    describe("timelineTeamLabels", () => {
      it("names the viewer's own team when it is known", () => {
        expect(timelineTeamLabels(0)).toEqual({ team0: "mon équipe", team1: "les adversaires" });
        expect(timelineTeamLabels(1)).toEqual({ team0: "les adversaires", team1: "mon équipe" });
      });

      it("falls back to neutral team numbers when the viewer is not in the match", () => {
        expect(timelineTeamLabels(null)).toEqual({ team0: "l'équipe 1", team1: "l'équipe 2" });
      });
    });

    describe("buildMatchTimelineSummary", () => {
      const labels = { team0: "mon équipe", team1: "les adversaires" };

      it("summarises a lead", () => {
        const summary = buildMatchTimelineSummary(
          series({ finalLead: 2, points: [{ atSeconds: 200, team0Level: 12, team1Level: 10, lead: 2 }] }),
          labels,
        );
        expect(summary).toBe("Niveau final : 12 – 10, mon équipe devant les adversaires (avance de 2 niveaux).");
      });

      it("summarises a deficit from the other side's point of view", () => {
        const summary = buildMatchTimelineSummary(
          series({ finalLead: -1, points: [{ atSeconds: 200, team0Level: 10, team1Level: 11, lead: -1 }] }),
          labels,
        );
        expect(summary).toBe("Niveau final : 11 – 10, les adversaires devant mon équipe (avance de 1 niveau).");
      });

      it("summarises an even game", () => {
        const summary = buildMatchTimelineSummary(
          series({ finalLead: 0, points: [{ atSeconds: 200, team0Level: 12, team1Level: 12, lead: 0 }] }),
          labels,
        );
        expect(summary).toBe("Niveau final : égalité 12 – 12.");
      });

      it("says so when there is no comparable point", () => {
        expect(buildMatchTimelineSummary(series({ points: [], finalLead: null }), labels)).toBe(
          "Chronologie indisponible : aucune donnée de niveau comparable.",
        );
      });
    });

    describe("formatTimelineLevel", () => {
      it("keeps a half level rather than rounding the difference away", () => {
        expect(formatTimelineLevel(12)).toBe("12");
        expect(formatTimelineLevel(12.5)).toBe("12.5");
      });
    });

    describe("timeline geometry", () => {
      it("maps a timestamp onto the width and clamps outside the match", () => {
        expect(timelineX(60, 120, 800)).toBe(400);
        expect(timelineX(200, 120, 800)).toBe(800);
        expect(timelineX(-10, 120, 800)).toBe(0);
      });

      it("maps everything to 0 when the match has no duration", () => {
        expect(timelineX(60, 0, 800)).toBe(0);
      });

      it("keeps a symmetric lead domain with a 1-level floor", () => {
        expect(timelineLeadMax([])).toBe(1);
        expect(timelineLeadMax([{ atSeconds: 0, team0Level: 1, team1Level: 1.5, lead: -0.5 }])).toBe(1);
        expect(
          timelineLeadMax([
            { atSeconds: 0, team0Level: 4, team1Level: 0, lead: 4 },
            { atSeconds: 1, team0Level: 0, team1Level: 2, lead: -2 },
          ]),
        ).toBe(4);
      });

      it("centres 0 and clamps leads to the domain", () => {
        expect(timelineLeadY(0, 4, 78, 62)).toBe(78);
        expect(timelineLeadY(4, 4, 78, 62)).toBe(16);
        expect(timelineLeadY(-4, 4, 78, 62)).toBe(140);
        expect(timelineLeadY(10, 4, 78, 62)).toBe(16);
      });

      it("sizes a death marker by its cluster, with a cap", () => {
        expect(deathMarkerRadius(1)).toBe(3);
        expect(deathMarkerRadius(2)).toBe(4.5);
        expect(deathMarkerRadius(100)).toBe(10);
      });
    });

- [ ] **Step 2: Run the tests to verify they fail**

Run: bun run --filter './apps/web' test app/composables/useMatchTimelineSeries.test.ts
Expected: FAIL -- timelineTeamLabels/buildMatchTimelineSummary/timelineX/timelineLeadMax/timelineLeadY/deathMarkerRadius are not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to apps/web/app/composables/useMatchTimelineSeries.ts:

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: bun run --filter './apps/web' test app/composables/useMatchTimelineSeries.test.ts
Expected: PASS.

- [ ] **Step 5: Commit**

    git add apps/web/app/composables/useMatchTimelineSeries.ts apps/web/app/composables/useMatchTimelineSeries.test.ts
    git commit -m "feat(web): add the C2 chronology summary and SVG geometry helpers"

---

### Task 3: Reactive composable and scrub position

**Files:**
- Modify: apps/web/app/composables/useMatchTimelineSeries.ts
- Test: apps/web/app/composables/useMatchTimelineSeries.test.ts

**Interfaces:**
- Consumes: buildMatchTimelineSeries, MatchTimelineInput, MatchTimelineSeries.
- Produces:
  - UseMatchTimelineSeriesResult { series: ComputedRef<MatchTimelineSeries>; durationSeconds: ComputedRef<number>; scrubPercent: Ref<number>; scrubSeconds: WritableComputedRef<number> }
  - useMatchTimelineSeries(input: ComputedRef<MatchTimelineInput>): UseMatchTimelineSeriesResult

- [ ] **Step 1: Write the failing test**

Append to apps/web/app/composables/useMatchTimelineSeries.test.ts:

    import { computed } from "vue";
    import { useMatchTimelineSeries } from "./useMatchTimelineSeries";

    describe("useMatchTimelineSeries", () => {
      it("starts at the end of the match and converts a scrubbed second back to a percent", () => {
        const source = computed(() => input({ durationSeconds: 200 }));
        const { scrubPercent, scrubSeconds, durationSeconds } = useMatchTimelineSeries(source);
        expect(durationSeconds.value).toBe(200);
        expect(scrubSeconds.value).toBe(200);

        scrubSeconds.value = 50;
        expect(scrubPercent.value).toBe(25);
        expect(scrubSeconds.value).toBe(50);
      });

      it("clamps the scrub position to the match's bounds", () => {
        const source = computed(() => input({ durationSeconds: 200 }));
        const { scrubSeconds } = useMatchTimelineSeries(source);
        scrubSeconds.value = 500;
        expect(scrubSeconds.value).toBe(200);
        scrubSeconds.value = -50;
        expect(scrubSeconds.value).toBe(0);
      });

      it("stays at 0 for a match with no duration", () => {
        const source = computed(() => input({ durationSeconds: 0 }));
        const { scrubSeconds } = useMatchTimelineSeries(source);
        scrubSeconds.value = 30;
        expect(scrubSeconds.value).toBe(0);
      });
    });

- [ ] **Step 2: Run the test to verify it fails**

Run: bun run --filter './apps/web' test app/composables/useMatchTimelineSeries.test.ts
Expected: FAIL -- useMatchTimelineSeries is not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to apps/web/app/composables/useMatchTimelineSeries.ts:

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

The vue import added in Task 1 already includes ComputedRef, Ref and WritableComputedRef; no import change is needed here.

- [ ] **Step 4: Run the test to verify it passes**

Run: bun run --filter './apps/web' test app/composables/useMatchTimelineSeries.test.ts
Expected: PASS.

- [ ] **Step 5: Commit**

    git add apps/web/app/composables/useMatchTimelineSeries.ts apps/web/app/composables/useMatchTimelineSeries.test.ts
    git commit -m "feat(web): add the reactive C2 chronology composable"

---

### Task 4: The chronology chart component

**Files:**
- Create: apps/web/app/components/charts/MatchTimelineChart.vue

**Interfaces:**
- Consumes: buildMatchTimelineSummary, deathMarkerRadius, timelineLeadMax, timelineLeadY, timelineTeamLabels, timelineX from ~/composables/useMatchTimelineSeries; MatchTimelineSeries from ~/types/coach; ALLY_TEAM_RGB / ENEMY_TEAM_RGB from ~/utils/spatialColors; auto-imported UiStateCard and formatDuration.
- Produces: <ChartsMatchTimelineChart> with props series, durationSeconds, scrubSeconds?, allyTeam? and event update:scrubSeconds.

- [ ] **Step 1: Create the component**

Create apps/web/app/components/charts/MatchTimelineChart.vue:

    <script setup lang="ts">
    import {
      buildMatchTimelineSummary,
      deathMarkerRadius,
      timelineLeadMax,
      timelineLeadY,
      timelineTeamLabels,
      timelineX,
    } from "~/composables/useMatchTimelineSeries";
    import type { MatchTimelineSeries } from "~/types/coach";
    import { ALLY_TEAM_RGB, ENEMY_TEAM_RGB } from "~/utils/spatialColors";

    const props = withDefaults(
      defineProps<{
        series: MatchTimelineSeries;
        /** Match length, the x-axis domain (never the last snapshot's time). */
        durationSeconds: number;
        /** Current scrub position in seconds (v-model:scrub-seconds); null hides the scrub line. */
        scrubSeconds?: number | null;
        /** The viewer's team, so the sides are named/coloured rather than numbered; null when the viewer isn't in this match. */
        allyTeam?: 0 | 1 | null;
      }>(),
      { scrubSeconds: null, allyTeam: null },
    );

    const emit = defineEmits<{
      "update:scrubSeconds": [value: number];
    }>();

    // Wide viewBox; the default preserveAspectRatio (xMidYMid meet) keeps every
    // circle round when the SVG stretches to the panel width.
    const WIDTH = 800;
    const HEIGHT = 240;
    const LEAD_TOP = 16;
    const LEAD_BOTTOM = 140;
    const LEAD_MID = (LEAD_TOP + LEAD_BOTTOM) / 2;
    const LEAD_HALF = (LEAD_BOTTOM - LEAD_TOP) / 2;
    const TEAM0_ROW_Y = 166;
    const TEAM1_ROW_Y = 190;
    const STRUCTURE_ROW_Y = 214;

    const labels = computed(() => timelineTeamLabels(props.allyTeam));

    const teamColors = computed<[string, string]>(() => {
      const ally = "rgb(" + ALLY_TEAM_RGB.join(", ") + ")";
      const enemy = "rgb(" + ENEMY_TEAM_RGB.join(", ") + ")";
      // Team 0 is the ally colour by default; when the viewer is on team 1 the
      // colours swap so the viewer's own team keeps the ally colour, exactly
      // like the heatmaps' "Par equipe" mode.
      return props.allyTeam === 1 ? [enemy, ally] : [ally, enemy];
    });

    const leadMax = computed(() => timelineLeadMax(props.series.points));

    const leadPoints = computed(() =>
      props.series.points.map((point) => ({
        ...point,
        x: timelineX(point.atSeconds, props.durationSeconds, WIDTH),
        y: timelineLeadY(point.lead, leadMax.value, LEAD_MID, LEAD_HALF),
      })),
    );

    const leadPolyline = computed(() => leadPoints.value.map((point) => point.x + "," + point.y).join(" "));

    const leadArea = computed(() => {
      const points = leadPoints.value;
      if (points.length === 0) return "";
      const first = points[0]!;
      const last = points[points.length - 1]!;
      return (
        "M " + first.x + "," + LEAD_MID +
        " L " + points.map((point) => point.x + "," + point.y).join(" L ") +
        " L " + last.x + "," + LEAD_MID + " Z"
      );
    });

    const deathMarkers = computed(() =>
      props.series.deaths.map((marker) => ({
        ...marker,
        x: timelineX(marker.atSeconds, props.durationSeconds, WIDTH),
        y: marker.team === 0 ? TEAM0_ROW_Y : TEAM1_ROW_Y,
        radius: deathMarkerRadius(marker.deaths),
        color: teamColors.value[marker.team],
      })),
    );

    const structureMarkers = computed(() =>
      props.series.structures.map((event) => ({
        ...event,
        x: timelineX(event.atSeconds, props.durationSeconds, WIDTH),
      })),
    );

    const scrubX = computed(() =>
      props.scrubSeconds === null ? null : timelineX(props.scrubSeconds, props.durationSeconds, WIDTH),
    );

    const summary = computed(() => buildMatchTimelineSummary(props.series, labels.value));
    const hasMarkers = computed(() => props.series.deaths.length > 0 || props.series.structures.length > 0);
    const showChart = computed(() => props.series.hasLevelData || hasMarkers.value);
    const sliderMax = computed(() => Math.max(0, Math.floor(props.durationSeconds)));

    function onScrub(event: Event) {
      const value = Number((event.target as HTMLInputElement).value);
      emit("update:scrubSeconds", Number.isFinite(value) ? value : 0);
    }
    </script>

    <template>
      <div class="space-y-3">
        <UiStateCard
          v-if="!series.hasLevelData"
          state="empty"
          size="sm"
          message="Données de niveau absentes pour cette partie : la courbe d'avance/retard ne peut pas être tracée (partie analysée avant l'extraction des niveaux, ou niveaux incomplets)."
        />

        <svg
          v-if="showChart"
          :viewBox="'0 0 ' + WIDTH + ' ' + HEIGHT"
          class="h-56 w-full"
          role="img"
          :aria-label="series.hasLevelData ? summary : 'Chronologie des morts et des structures de cette partie.'"
        >
          <template v-if="series.hasLevelData">
            <line
              x1="0"
              :y1="LEAD_MID"
              :x2="WIDTH"
              :y2="LEAD_MID"
              class="text-border"
              stroke="currentColor"
              stroke-width="1"
              stroke-dasharray="4 4"
            />
            <path :d="leadArea" class="text-brand" fill="currentColor" fill-opacity="0.12" />
            <polyline
              v-if="leadPoints.length > 1"
              :points="leadPolyline"
              fill="none"
              class="text-brand"
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
            <circle
              v-else-if="leadPoints.length === 1"
              :cx="leadPoints[0]!.x"
              :cy="leadPoints[0]!.y"
              r="3"
              class="text-brand"
              fill="currentColor"
            />
          </template>

          <circle
            v-for="(marker, index) in deathMarkers"
            :key="'death-' + index"
            :cx="marker.x"
            :cy="marker.y"
            :r="marker.radius"
            :fill="marker.color"
            fill-opacity="0.85"
            stroke="rgba(0, 0, 0, 0.6)"
            stroke-width="1"
          >
            <title>{{ marker.deaths }} mort(s) {{ marker.team === 0 ? labels.team0 : labels.team1 }} à {{ formatDuration(marker.atSeconds) }}</title>
          </circle>

          <rect
            v-for="(event, index) in structureMarkers"
            :key="'structure-' + index"
            :x="event.x - 4"
            :y="STRUCTURE_ROW_Y - 4"
            width="8"
            height="8"
            fill="currentColor"
            fill-opacity="0.7"
            class="text-muted"
          >
            <title>{{ event.structureType }} détruit à {{ formatDuration(event.atSeconds) }} ({{ event.team === 0 ? labels.team0 : labels.team1 }}) — détection best-effort</title>
          </rect>

          <line
            v-if="scrubX !== null"
            :x1="scrubX"
            y1="6"
            :x2="scrubX"
            :y2="STRUCTURE_ROW_Y + 8"
            class="text-foreground"
            stroke="currentColor"
            stroke-width="1"
            stroke-dasharray="3 3"
          />

          <text x="0" :y="HEIGHT - 4" fill="currentColor" class="text-muted" font-size="12">0:00</text>
          <text :x="WIDTH" :y="HEIGHT - 4" fill="currentColor" class="text-muted" font-size="12" text-anchor="end">
            {{ formatDuration(durationSeconds) }}
          </text>
        </svg>

        <template v-if="series.hasLevelData">
          <div class="flex flex-wrap items-center gap-3 text-[11px] text-muted">
            <span class="flex items-center gap-1.5">
              <span class="h-2 w-2 rounded-full" :style="{ background: teamColors[0] }" />
              {{ labels.team0 }}
            </span>
            <span class="flex items-center gap-1.5">
              <span class="h-2 w-2 rounded-full" :style="{ background: teamColors[1] }" />
              {{ labels.team1 }}
            </span>
            <span v-if="series.deaths.length > 0">Morts : la taille du point = morts groupées</span>
            <span v-if="series.structures.length > 0">Structures détruites : {{ series.structures.length }} (best-effort)</span>
          </div>

          <label class="flex flex-col gap-1 text-xs text-muted">
            <span>Position dans la chronologie : {{ formatDuration(scrubSeconds ?? durationSeconds) }}</span>
            <input
              type="range"
              min="0"
              :max="sliderMax"
              step="1"
              :value="scrubSeconds ?? sliderMax"
              aria-label="Position dans la chronologie de la partie"
              @input="onScrub"
            />
          </label>
        </template>

        <p v-else-if="hasMarkers" class="text-[11px] text-muted">
          Morts et structures restent tracées ci-dessus ; seule la courbe de niveaux est indisponible.
        </p>
      </div>
    </template>

- [ ] **Step 2: Typecheck**

Run: bun run typecheck
Expected: no new errors.

- [ ] **Step 3: Commit**

    git add apps/web/app/components/charts/MatchTimelineChart.vue
    git commit -m "feat(web): add the C2 match chronology SVG chart"

---

### Task 5: The Chronologie tab on the match page

**Files:**
- Modify: apps/web/app/pages/matches/[id].vue

**Interfaces:**
- Consumes: useMatchTimelineSeries, MatchTimelineInput, ChartsMatchTimelineChart.
- Produces: a third tab chronology, plus page-level timelineScrubSeconds (shared with Task 6).

- [ ] **Step 1: Add the tab and the page wiring**

In apps/web/app/pages/matches/[id].vue, add the explicit type import at the top (after the existing type imports):

    import type { MatchTimelineInput } from "~/composables/useMatchTimelineSeries";

Add the third entry to tabItems:

    const tabItems = [
      { label: "Statistiques & Scoreboard", icon: "i-heroicons-table-cells", slot: "scoreboard" as const },
      { label: "Heatmaps & Placement", icon: "i-heroicons-viewfinder-circle", slot: "heatmaps" as const },
      { label: "Chronologie", icon: "i-heroicons-clock", slot: "chronology" as const },
    ];

After viewerEnemyRows (the end of the "Tab 1" block), add the chronology wiring:

    // --- Tab 3: chronology -----------------------------------------------------

    const timelineInput = computed<MatchTimelineInput>(() => ({
      timeline: data.value?.timeline ?? null,
      players: allPlayers.value.map((player) => ({ battletag: player.battletag, team: player.team })),
      durationSeconds: data.value?.match.durationSeconds ?? 0,
    }));

    const { series: timelineSeries, scrubSeconds: timelineScrubSeconds } = useMatchTimelineSeries(timelineInput);

    /** The team the viewer played on, so the chronology says "mon équipe"
     * rather than "équipe 0"; null when the viewer isn't in this match. */
    const viewerTeam = computed<0 | 1 | null>(() => {
      const mine = scoreboardRows.value.find((row) => row.isMe);
      return mine ? (mine.team === 0 ? 0 : 1) : null;
    });

Add the tab template after the #heatmaps template:

    <template #chronology>
      <div class="mt-4">
        <ChartsMatchTimelineChart
          :series="timelineSeries"
          :duration-seconds="data.match.durationSeconds"
          :scrub-seconds="timelineScrubSeconds"
          :ally-team="viewerTeam"
          @update:scrub-seconds="timelineScrubSeconds = $event"
        />
      </div>
    </template>

- [ ] **Step 2: Typecheck and run the web tests**

Run: bun run typecheck
Run: bun run --filter './apps/web' test
Expected: both PASS.

- [ ] **Step 3: Commit**

    git add apps/web/app/pages/matches/[id].vue
    git commit -m "feat(web): add the Chronologie tab to the match page"

---

### Task 6: Scrubber highlights the same moment on the heatmap tab

**Files:**
- Modify: apps/web/app/utils/deathClustering.ts
- Modify: apps/web/app/utils/deathClustering.test.ts
- Modify: apps/web/app/components/spatial/SpatialMarkerLayer.vue
- Modify: apps/web/app/components/spatial/SpatialHeatmapView.vue
- Modify: apps/web/app/components/spatial/SpatialSlotGroup.vue
- Modify: apps/web/app/pages/matches/[id].vue

**Interfaces:**
- Consumes: SpatialEventCluster, CLUSTER_TIME_WINDOW_SECONDS.
- Produces:
  - HIGHLIGHT_WINDOW_SECONDS = CLUSTER_TIME_WINDOW_SECONDS
  - isClusterHighlighted(cluster: SpatialEventCluster, atSeconds: number | null | undefined): boolean
  - an optional highlightAtSeconds?: number | null prop on SpatialMarkerLayer, SpatialHeatmapView and SpatialSlotGroup (default null = unchanged rendering).

- [ ] **Step 1: Write the failing test**

Append to apps/web/app/utils/deathClustering.test.ts (add isClusterHighlighted to the existing import):

    import { buildSpatialEventPoints, clusterSpatialEvents, isClusterHighlighted, type SpatialEventPoint } from "./deathClustering";

    describe("isClusterHighlighted", () => {
      const cluster = { kind: "death" as const, x: 0.5, y: 0.5, atSeconds: 100, points: [point({ atSeconds: 100 })] };

      it("highlights a cluster within the window of the scrubbed time", () => {
        expect(isClusterHighlighted(cluster, 100)).toBe(true);
        expect(isClusterHighlighted(cluster, 108)).toBe(true);
      });

      it("does not highlight a cluster outside the window", () => {
        expect(isClusterHighlighted(cluster, 109)).toBe(false);
        expect(isClusterHighlighted(cluster, 50)).toBe(false);
      });

      it("highlights nothing while the scrubber has no position", () => {
        expect(isClusterHighlighted(cluster, null)).toBe(false);
        expect(isClusterHighlighted(cluster, undefined)).toBe(false);
      });
    });

- [ ] **Step 2: Run the test to verify it fails**

Run: bun run --filter './apps/web' test app/utils/deathClustering.test.ts
Expected: FAIL -- isClusterHighlighted is not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to apps/web/app/utils/deathClustering.ts:

    /** How close (seconds) a cluster's mean timestamp must be to the
     * chronology scrub position for the heatmap to highlight it -- the same
     * 8s window the clustering itself uses, so a highlighted blob is a real
     * cluster, not a coincidental neighbour. */
    export const HIGHLIGHT_WINDOW_SECONDS = CLUSTER_TIME_WINDOW_SECONDS;

    /**
     * True when cluster happened within HIGHLIGHT_WINDOW_SECONDS of the
     * timeline's scrub position. A null/absent position highlights nothing.
     */
    export function isClusterHighlighted(
      cluster: SpatialEventCluster,
      atSeconds: number | null | undefined,
    ): boolean {
      if (atSeconds === null || atSeconds === undefined || !Number.isFinite(atSeconds)) return false;
      return Math.abs(cluster.atSeconds - atSeconds) <= HIGHLIGHT_WINDOW_SECONDS;
    }

- [ ] **Step 4: Run the test to verify it passes**

Run: bun run --filter './apps/web' test app/utils/deathClustering.test.ts
Expected: PASS.

- [ ] **Step 5: Thread the prop through the three spatial components**

In apps/web/app/components/spatial/SpatialMarkerLayer.vue:

- replace the existing type-only import with:

    import { isClusterHighlighted, type SpatialEventCluster } from "~/utils/deathClustering";

- add the prop and its default:

    const props = withDefaults(
      defineProps<{
        clusters: SpatialEventCluster[];
        aspectRatio?: number;
        /** Timeline scrub position, in seconds; clusters within the clustering window of it are emphasised. Null = nothing highlighted. */
        highlightAtSeconds?: number | null;
      }>(),
      { aspectRatio: 1, highlightAtSeconds: null },
    );

- on the per-cluster <g>, dim the non-highlighted ones once a position is set, add a ring on the highlighted ones, and express the existing transform without a template literal:

    <g
      v-for="(cluster, i) in props.clusters"
      :key="i"
      class="pointer-events-auto cursor-pointer"
      :transform="'translate(' + cluster.x + ' ' + toSvgY(cluster.y) + ') scale(1 ' + aspectRatio + ')'"
      :opacity="highlightAtSeconds === null || isClusterHighlighted(cluster, highlightAtSeconds) ? 1 : 0.25"
      @click="emit('select-cluster', cluster)"
    >
      <circle
        v-if="isClusterHighlighted(cluster, highlightAtSeconds)"
        cx="0"
        cy="0"
        r="0.028"
        fill="none"
        stroke="white"
        stroke-width="0.004"
        vector-effect="non-scaling-stroke"
      />

(keep the existing kill/death shapes and the "+N" badge inside the same <g>, unchanged.)

In apps/web/app/components/spatial/SpatialHeatmapView.vue:

- add the prop to the defineProps block, with its default in the withDefaults object:

    /** Timeline scrub position, in seconds -- forwarded to SpatialMarkerLayer so the match page's chronology can highlight the deaths around it. */
    highlightAtSeconds?: number | null;

    { /* ...existing defaults... */ highlightAtSeconds: null }

- pass it to the marker layer:

    <SpatialMarkerLayer
      v-if="markerClusters && (showKills || showDeaths) && naturalHeight > 0"
      :clusters="markerClusters.filter((c) => (c.kind === 'kill' ? showKills : showDeaths))"
      :aspect-ratio="naturalWidth / naturalHeight"
      :highlight-at-seconds="highlightAtSeconds"
      @select-cluster="(c) => emit('select-cluster', c)"
    />

In apps/web/app/components/spatial/SpatialSlotGroup.vue:

- add the prop and its default:

    /** Timeline scrub position, in seconds, forwarded to every heatmap so the match page's chronology can highlight the deaths around it. */
    highlightAtSeconds?: number | null;

    { matchHeroes: () => [], matchDeaths: () => [], highlightAtSeconds: null }

- add :highlight-at-seconds="highlightAtSeconds" to all four <SpatialHeatmapView> usages in that file.

- [ ] **Step 6: Wire the page**

In apps/web/app/pages/matches/[id].vue, on the existing <SpatialSlotGroup> inside #heatmaps, add:

    :highlight-at-seconds="timelineScrubSeconds"

- [ ] **Step 7: Typecheck and run the web tests**

Run: bun run typecheck
Run: bun run --filter './apps/web' test
Expected: both PASS.

- [ ] **Step 8: Commit**

    git add apps/web/app/utils/deathClustering.ts apps/web/app/utils/deathClustering.test.ts apps/web/app/components/spatial/SpatialMarkerLayer.vue apps/web/app/components/spatial/SpatialHeatmapView.vue apps/web/app/components/spatial/SpatialSlotGroup.vue apps/web/app/pages/matches/[id].vue
    git commit -m "feat(web): highlight the scrubbed moment on the match heatmap"

---

### Task 7: Full gate, roadmap bookkeeping, push

- [ ] **Step 1: Run the whole gate**

    bun run typecheck
    bun test packages/shared-types
    bun test apps/api
    bun run --filter './apps/web' test
    cd daemon-python && pytest -q

Expected: all green (shared-types/API/daemon untouched, kept as a CI-parity check).

- [ ] **Step 2: Tick the roadmap**

In tasks/progression-roadmap.md, change "- [ ] **C2" to "- [x]", and append a "**Fait** (2026-09-18)" paragraph listing the deviations:

- the pure derivation is in useMatchTimelineSeries.ts, tested by useMatchTimelineSeries.test.ts (not a component test);
- the scrubber-to-heatmap link required an additive optional highlightAtSeconds prop through SpatialSlotGroup -> SpatialHeatmapView -> SpatialMarkerLayer, plus isClusterHighlighted in deathClustering.ts;
- no API/DB/migration change (the timeline was already on GET /matches/:id);
- the chart is a hand-rolled SVG (no new dependency), as with the sparkline.ts precedent.

- [ ] **Step 3: One line in tasks/README.md**

Add a line to the "Déjà fait" section summarising C2.

- [ ] **Step 4: Commit and push only if the whole gate is green**

    git add tasks/progression-roadmap.md tasks/README.md
    git commit -m "docs(tasks): tick C2 and record the chronology deviations"
    git push origin main
