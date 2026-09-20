<script setup lang="ts">
import { formatTimelineLevel, timelineEventLabel, timelineTeamLabels } from "~/composables/useMatchTimelineSeries";
import type { MatchTimelineSurroundings } from "~/composables/useMatchTimelineSeries";
import type { MatchTimelineFocus, MatchTimelineSeries, MatchTimelineStateAt } from "~/types/coach";
import { ALLY_TEAM_RGB, ENEMY_TEAM_RGB } from "~/utils/spatialColors";

const props = withDefaults(
  defineProps<{
    series: MatchTimelineSeries;
    /** The instant the panel describes -- the same cursor the chart draws. */
    seconds: number;
    state: MatchTimelineStateAt;
    /** The last event before the cursor and the next few after it. */
    around: MatchTimelineSurroundings;
    /** The death under the cursor, when there is one. */
    focus?: MatchTimelineFocus | null;
    /** The viewer's team, so the panel says "mon équipe" rather than "équipe 0". */
    allyTeam?: 0 | 1 | null;
  }>(),
  { focus: null, allyTeam: null },
);

const emit = defineEmits<{ seek: [seconds: number] }>();

const labels = computed(() => timelineTeamLabels(props.allyTeam));

const teamColors = computed<[string, string]>(() => {
  const ally = "rgb(" + ALLY_TEAM_RGB.join(", ") + ")";
  const enemy = "rgb(" + ENEMY_TEAM_RGB.join(", ") + ")";
  return props.allyTeam === 1 ? [enemy, ally] : [ally, enemy];
});

function teamLabel(team: 0 | 1): string {
  return team === 0 ? labels.value.team0 : labels.value.team1;
}

const levelsLabel = computed(() => {
  const { team0Level, team1Level } = props.state;
  if (team0Level === null || team1Level === null) return null;
  return (
    labels.value.team0 + " " + formatTimelineLevel(team0Level) +
    " · " + labels.value.team1 + " " + formatTimelineLevel(team1Level)
  );
});

const leadLabel = computed(() => {
  const lead = props.state.lead;
  if (lead === null) return null;
  if (lead === 0) return "égalité";
  const ahead = lead > 0 ? labels.value.team0 : labels.value.team1;
  const gap = formatTimelineLevel(Math.abs(lead));
  return ahead + " devant de " + gap + (Math.abs(lead) > 1 ? " niveaux" : " niveau");
});

const victimLane = computed(() =>
  props.focus ? (props.series.lanes.find((lane) => lane.battletag === props.focus!.victim.battletag) ?? null) : null,
);

/** The others caught in the same fight, so a pick reads as a fight and not a
 * lone stat. */
const fightOthers = computed(() =>
  props.focus
    ? props.focus.fight.filter(
        (death) =>
          !(death.battletag === props.focus!.victim.battletag && death.atSeconds === props.focus!.victim.atSeconds),
      )
    : [],
);

/** Width of the fight, in seconds; null when this death stood alone. */
const fightSpanSeconds = computed(() => {
  if (!props.focus || props.focus.fight.length < 2) return null;
  const times = props.focus.fight.map((death) => death.atSeconds);
  return Math.round(Math.max(...times) - Math.min(...times));
});

const killersLabel = computed(() => {
  const victim = props.focus?.victim;
  if (!victim) return null;
  if (victim.killerNames.length > 0) return victim.killerNames.join(" + ");
  if (victim.killType === "other") return "hors combat (créatures, tour, cœur…)";
  return "tueurs non enregistrés";
});

const killTypeLabel = computed(() => {
  const victim = props.focus?.victim;
  if (!victim) return null;
  if (victim.killType === "hero") return "Mort au combat";
  if (victim.killType === "other") return "Mort hors combat";
  return null;
});

const hasRail = computed(() => props.around.previous !== null || props.around.upcoming.length > 0);
</script>

<template>
  <aside class="flex flex-col overflow-hidden rounded-lg border border-border bg-surface lg:min-h-0">
    <header class="shrink-0 border-b border-border p-3">
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-heading text-lg font-semibold tabular-nums">à {{ formatDuration(seconds) }}</span>
        <span
          v-if="killTypeLabel"
          class="rounded px-1.5 py-0.5 text-[10px] font-medium"
          :class="focus!.victim.killType === 'other' ? 'bg-muted/15 text-muted' : 'bg-danger/15 text-danger'"
        >
          {{ killTypeLabel }}
        </span>
      </div>
      <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt class="text-muted">Niveaux</dt>
        <dd class="text-foreground">{{ levelsLabel ?? "inconnus à cet instant" }}</dd>
        <dt class="text-muted">Avance</dt>
        <dd :class="leadLabel ? 'text-foreground' : 'text-muted'">{{ leadLabel ?? "—" }}</dd>
      </dl>
    </header>

    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <section v-if="focus" class="rounded-md border border-border bg-elevated/40 p-2.5">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: teamColors[focus.victim.team] }" />
          <span class="font-medium text-foreground">{{ focus.victim.heroName ?? focus.victim.battletag }}</span>
          <span class="text-xs text-muted">
            {{ teamLabel(focus.victim.team) }}<template v-if="victimLane?.isMe"> · moi</template>
          </span>
        </div>

        <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt class="text-muted">Cause</dt>
          <dd :class="focus.victim.killerNames.length > 0 ? 'text-foreground' : 'text-muted'">{{ killersLabel }}</dd>
          <dt class="text-muted">Escarmouche</dt>
          <dd class="text-muted">
            <template v-if="fightSpanSeconds !== null">{{ focus.fight.length }} morts en {{ fightSpanSeconds }} s</template>
            <template v-else>mort isolée</template>
          </dd>
        </dl>

        <ul v-if="fightOthers.length > 0" class="mt-1.5 space-y-0.5">
          <li v-for="death in fightOthers" :key="death.battletag + '-' + death.atSeconds" class="flex items-center gap-1.5 text-xs text-muted">
            <span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full" :style="{ background: teamColors[death.team] }" />
            <span class="truncate">{{ death.heroName ?? death.battletag }}</span>
            <span class="ml-auto shrink-0 tabular-nums">{{ formatDuration(death.atSeconds) }}</span>
          </li>
        </ul>
      </section>

      <p v-else class="text-xs text-muted">
        Survolez le graphe pour lire l'instant, et une mort pour sa fiche complète.
      </p>

      <section v-if="hasRail">
        <p class="mb-1 text-[10px] uppercase tracking-wide text-muted">Autour de cet instant</p>
        <ul class="space-y-0.5">
          <li v-if="around.previous">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs text-muted transition-colors hover:bg-elevated/40 hover:text-foreground"
              @click="emit('seek', around.previous!.atSeconds)"
            >
              <UIcon name="i-heroicons-arrow-left" class="h-3 w-3 shrink-0" />
              <span class="shrink-0 tabular-nums">{{ formatDuration(around.previous.atSeconds) }}</span>
              <span class="truncate">{{ timelineEventLabel(around.previous) }}</span>
            </button>
          </li>
          <li v-for="event in around.upcoming" :key="event.kind + '-' + event.atSeconds">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs text-muted transition-colors hover:bg-elevated/40 hover:text-foreground"
              @click="emit('seek', event.atSeconds)"
            >
              <UIcon name="i-heroicons-arrow-right" class="h-3 w-3 shrink-0" />
              <span class="shrink-0 tabular-nums">{{ formatDuration(event.atSeconds) }}</span>
              <span class="truncate">{{ timelineEventLabel(event) }}</span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  </aside>
</template>
