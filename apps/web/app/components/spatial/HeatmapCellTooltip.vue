<script setup lang="ts">
import type { EventRecap } from "~/utils/eventRecap";
import type { HeatmapCellDetail } from "~/utils/heatmapCellDetails";
import { formatClock } from "~/utils/heatmapCellDetails";
import { formatTimelineLevel } from "~/composables/useMatchTimelineSeries";

/**
 * The per-cell panel every spatial heatmap shows on hover -- "written" stats for
 * one grid cell: how long each tracked hero stood there, and (for a match view)
 * the compact recap of every kill/death under the cursor, with the viewer's own
 * hero always spelled out as "Toi (Héros)" so it can never be mistaken for a
 * teammate.
 *
 * Deliberately compact: the full recap (team states, proximity, level lead,
 * fight exchange, objective context) lives in `SpatialEventRecapPanel.vue`,
 * which the same click that opens the detail also feeds. Beyond
 * `MAX_RECAP_LINES` events this only says "+N autres".
 *
 * Purely presentational and `pointer-events-none`: the parent owns the hover
 * state and cell lookup (see `SpatialHeatmapView.vue`), so this stays free of
 * DOM events and reusable by any canvas.
 */
const props = defineProps<{
  /** The hovered cell's own content. Null when the caller only has recap lines
   * to show -- a marker can stand in a cell with no presence sample at all. */
  detail?: HeatmapCellDetail | null;
  /** Cursor position in px, relative to the map container this panel is rendered in. */
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
  /** Matches behind an aggregate ("Historique") view, shown as context. */
  matchCount?: number;
  /** Compact one-per-event recap lines. Empty for a view with no per-event
   * death data, which falls back to `detail.events`' plain sentences. */
  recaps?: EventRecap[];
}>();

const MAX_RECAP_LINES = 4;

/**
 * Flips to the other side of the cursor once it passes the container's middle,
 * instead of measuring the panel: a fixed-size flip can't jitter, and every
 * panel is small relative to its map, so "place it on the emptier half" is
 * enough to keep it inside a container that is `overflow-hidden` (the map's
 * rounded corners need that clip).
 */
const panelStyle = computed(() => {
  const placeLeft = props.x > props.containerWidth / 2;
  const placeAbove = props.y > props.containerHeight / 2;
  return {
    left: `${props.x}px`,
    top: `${props.y}px`,
    transform: `translate(${placeLeft ? "calc(-100% - 12px)" : "12px"}, ${placeAbove ? "calc(-100% - 12px)" : "12px"})`,
  };
});

const recaps = computed(() => props.recaps ?? []);
const visibleRecaps = computed(() => recaps.value.slice(0, MAX_RECAP_LINES));
const hiddenRecaps = computed(() => Math.max(0, recaps.value.length - MAX_RECAP_LINES));

const killsShareLabel = computed(() => shareLabel(props.detail?.killsShare ?? null));
const deathsShareLabel = computed(() => shareLabel(props.detail?.deathsShare ?? null));

function shareLabel(share: number | null): string | null {
  if (share === null) return null;
  if (share > 0 && share < 0.01) return "<1%";
  return formatPercent(share);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count > 1 ? "s" : ""}`;
}

/** "Kael'thas (ennemi) ← Raynor (allié)", the one line a hover must get right. */
function headline(recap: EventRecap): string {
  if (recap.killers.length === 0) {
    return `${recap.victimLabel} ← ${recap.killType === "other" ? "cause non-héroïque" : "sans tueur crédité"}`;
  }
  return `${recap.victimLabel} ← ${recap.killers.map((killer) => killer.label).join(" + ")}`;
}

/** The handful of facts that fit under `headline`: where the match stood, who
 * was on the map, and the level gap at that exact second. */
function facts(recap: EventRecap): string {
  const parts: string[] = [];
  if (recap.matchProgress !== null) parts.push(`${formatPercent(recap.matchProgress)} du match`);
  parts.push(`${recap.teamState.allies.present} vs ${recap.teamState.enemies.present} sur le terrain`);
  if (recap.proximity.known) parts.push(`${plural(recap.proximity.allies + recap.proximity.enemies, "héros")} à proximité`);
  if (recap.advantage) {
    const lead = recap.advantage.lead;
    parts.push(`${lead > 0 ? "+" : ""}${formatTimelineLevel(lead)} niv`);
  }
  if (recap.isFirstDeath) parts.push("1re mort de la partie");
  if (recap.staggerDelaySeconds !== null) parts.push(`décalé de ${recap.staggerDelaySeconds} s`);
  return parts.join(" · ");
}
</script>

<template>
  <div
    class="pointer-events-none absolute z-30 w-60 rounded-md border border-border bg-surface/95 p-2 text-[11px] leading-snug shadow-lg backdrop-blur-sm"
    :style="panelStyle"
  >
    <SpatialPresenceList
      v-if="detail && detail.presence.length > 0"
      :presence="detail.presence"
      :total-seconds="detail.totalSeconds"
      :hidden="detail.presenceHidden"
    />

    <div
      v-if="recaps.length > 0 || detail"
      class="space-y-0.5 pt-1.5"
      :class="detail && detail.presence.length > 0 ? 'mt-1.5 border-t border-border' : ''"
    >
      <p v-if="detail && (detail.kills > 0 || detail.deaths > 0 || killsShareLabel || deathsShareLabel)" class="text-muted">
        <!-- A side is dropped only when it is *both* zero here and absent from
             the whole view (a death map has no kills at all) -- otherwise "0
             kill (0%)" is a real answer about this cell. -->
        <template v-if="detail.kills > 0 || killsShareLabel">
          <span :class="detail.kills > 0 ? 'font-medium text-foreground' : ''">{{ plural(detail.kills, "kill") }}</span>
          <span v-if="killsShareLabel"> ({{ killsShareLabel }})</span>
        </template>
        <span v-if="(detail.kills > 0 || killsShareLabel) && (detail.deaths > 0 || deathsShareLabel)"> · </span>
        <template v-if="detail.deaths > 0 || deathsShareLabel">
          <span :class="detail.deaths > 0 ? 'font-medium text-foreground' : ''">{{ plural(detail.deaths, "mort") }}</span>
          <span v-if="deathsShareLabel"> ({{ deathsShareLabel }})</span>
        </template>
      </p>

      <ul v-if="visibleRecaps.length > 0" class="space-y-1">
        <li v-for="(recap, i) in visibleRecaps" :key="i">
          <span class="font-mono text-foreground">{{ recap.clock }}</span>
          <span :class="recap.kind === 'death' ? 'text-danger' : 'text-success'">
            {{ recap.kind === "kill" ? "Kill" : "Mort" }}
          </span>
          <span class="block">{{ headline(recap) }}</span>
          <span class="block text-muted">{{ facts(recap) }}</span>
        </li>
        <li v-if="hiddenRecaps > 0" class="text-muted">+{{ hiddenRecaps }} autre{{ hiddenRecaps > 1 ? "s" : "" }}</li>
      </ul>

      <!-- Fallback for a caller that only has the cell detail (no per-event
           recap input): the plain "3:12 Toi (Jaina) a tué ..." sentences. -->
      <ul v-else-if="detail">
        <li
          v-for="(event, i) in detail.events"
          :key="i"
          :class="event.isMe ? 'font-semibold text-foreground' : 'text-muted'"
        >
          <span class="font-mono">{{ formatClock(event.atSeconds) }}</span> {{ event.text }}
        </li>
        <li v-if="detail.eventsHidden > 0" class="text-muted">
          +{{ detail.eventsHidden }} autre{{ detail.eventsHidden > 1 ? "s" : "" }}
        </li>
      </ul>

      <p v-if="visibleRecaps.length > 0" class="text-muted">Clic pour le détail complet.</p>
    </div>

    <p v-if="matchCount && matchCount > 0" class="mt-1 text-muted">
      Sur {{ plural(matchCount, "partie") }}
    </p>
  </div>
</template>
