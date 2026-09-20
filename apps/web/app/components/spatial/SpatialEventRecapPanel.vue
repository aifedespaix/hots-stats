<script setup lang="ts">
import type { HeatmapCellDetail } from "~/utils/heatmapCellDetails";
import type { EventRecap } from "~/utils/eventRecap";
import { formatTimelineLevel } from "~/composables/useMatchTimelineSeries";

/**
 * The full kill/death recap, in a floating block over the map's right edge --
 * what the compact hover tooltip can't fit. Opened by clicking a marker or a
 * cell (see `SpatialHeatmapView.vue`, which owns the selection) and closed by
 * its ×, Escape, or by selecting something else.
 *
 * Rendered as a sibling of the map container (never inside it), so the image
 * export and the pointer-driven cell hover stay untouched by it.
 */
defineProps<{
  /** The clicked spot's own presence/clock content, shown above the events. */
  cellDetail: HeatmapCellDetail;
  /** One entry per kill/death in the selection, chronological. */
  recaps: EventRecap[];
  title: string;
  subtitle?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const STRUCTURE_LABELS: Record<string, string> = {
  fort: "Fort",
  keep: "Donjon",
  wall: "Mur",
  core: "Cœur",
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count > 1 ? "s" : ""}`;
}

function levelLabel(level: number): string {
  return formatTimelineLevel(level);
}

/** "a tué b", or the non-heroic cause when the replay credited nobody. */
function killerLabel(recap: EventRecap): string {
  if (recap.killers.length === 0) return recap.killType === "other" ? "cause non-héroïque" : "sans tueur crédité";
  return recap.killers.map((killer) => killer.label).join(" + ");
}

function signedLevels(recap: EventRecap): string {
  return `${levelLabel(recap.advantage!.allyLevel)} vs ${levelLabel(recap.advantage!.enemyLevel)} (${
    recap.advantage!.lead >= 0 ? "+" : ""
  }${levelLabel(recap.advantage!.lead)})`;
}

/** "détruit 12 s plus tard" / "détruit 8 s plus tôt", from the death's point of view. */
function structureTiming(recap: EventRecap): string {
  const delta = recap.structure!.deltaSeconds;
  if (delta === 0) return "détruit au même instant";
  return delta > 0 ? `détruit ${delta} s plus tard` : `détruit ${Math.abs(delta)} s plus tôt`;
}

function fightDuration(recap: EventRecap): number {
  return Math.max(0, Math.round(recap.bilan.endSeconds - recap.bilan.startSeconds));
}
</script>

<template>
  <aside
    class="pointer-events-auto absolute right-2 top-2 z-40 flex max-h-[calc(100%-1rem)] w-72 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-md border border-border bg-surface/95 text-[11px] leading-snug shadow-lg backdrop-blur-sm"
  >
    <header class="flex items-start gap-2 border-b border-border p-2">
      <div class="min-w-0">
        <p class="truncate font-medium text-foreground">{{ title }}</p>
        <p v-if="subtitle" class="text-muted">{{ subtitle }}</p>
      </div>
      <UButton
        class="ml-auto shrink-0"
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-x-mark"
        aria-label="Fermer le détail"
        @click="emit('close')"
      />
    </header>

    <div class="space-y-2 overflow-y-auto p-2">
      <SpatialPresenceList
        v-if="cellDetail.presence.length > 0"
        :presence="cellDetail.presence"
        :total-seconds="cellDetail.totalSeconds"
        :hidden="cellDetail.presenceHidden"
      />

      <p v-else-if="recaps.length === 0" class="text-muted">Rien à signaler sur cette zone.</p>

      <article
        v-for="(recap, i) in recaps"
        :key="i"
        class="space-y-1 border-t border-border pt-2 first:border-t-0 first:pt-0"
      >
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="font-mono text-foreground">{{ recap.clock }}</span>
          <span
            class="rounded px-1 py-px text-[10px] font-medium"
            :class="recap.kind === 'kill' ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'"
          >
            {{ recap.kind === "kill" ? "Kill" : "Mort" }}
          </span>
          <span v-if="recap.matchProgress !== null" class="text-muted">{{ formatPercent(recap.matchProgress) }} du match</span>
          <span v-if="recap.isFirstDeath" class="rounded border border-border px-1 py-px text-[10px] text-muted">1re mort</span>
        </div>

        <p>
          <span class="font-semibold text-foreground">{{ recap.victimLabel }}</span>
          <span class="text-muted"> ← {{ killerLabel(recap) }}</span>
        </p>

        <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted">
          <dt>Équipes</dt>
          <dd class="text-foreground">
            {{ plural(recap.teamState.allies.down, "allié") }} au sol · {{ plural(recap.teamState.enemies.down, "adverse") }} au sol
            <span class="text-muted">({{ recap.teamState.allies.present }} vs {{ recap.teamState.enemies.present }} sur le terrain)</span>
          </dd>

          <dt>Proximité</dt>
          <dd v-if="recap.proximity.known" class="text-foreground">
            {{ plural(recap.proximity.allies, "allié") }} · {{ plural(recap.proximity.enemies, "adverse") }} autour
            <span v-if="recap.proximity.closestEnemyDistance !== null" class="text-muted">
              (le plus proche à {{ Math.round(recap.proximity.closestEnemyDistance * 100) }} % de la carte)
            </span>
          </dd>
          <dd v-else class="text-muted">donnée indisponible</dd>

          <dt>Niveau</dt>
          <dd v-if="recap.advantage" class="text-foreground">
            {{ signedLevels(recap) }}
            <span class="text-muted">· palier {{ recap.advantage.allyTier }} vs {{ recap.advantage.enemyTier }}</span>
          </dd>
          <dd v-else class="text-muted">donnée indisponible</dd>

          <dt>Échange</dt>
          <dd class="text-foreground">
            {{ plural(recap.bilan.allyKills, "kill") }} · {{ plural(recap.bilan.enemyKills, "kill") }} adverses
            <span class="text-muted">sur {{ fightDuration(recap) }} s</span>
          </dd>

          <template v-if="recap.staggerDelaySeconds !== null">
            <dt>Décalé</dt>
            <dd class="text-danger">tombé {{ recap.staggerDelaySeconds }} s après le premier allié du fight</dd>
          </template>

          <template v-if="recap.structure">
            <dt>Objectif</dt>
            <dd class="text-foreground">
              {{ STRUCTURE_LABELS[recap.structure.structureType] ?? recap.structure.structureType }}
              {{ recap.structure.team === recap.victimTeam ? "de son camp" : "adverse" }} {{ structureTiming(recap) }}
            </dd>
          </template>
        </dl>
      </article>
    </div>
  </aside>
</template>
