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

const levelLabel = computed(() => {
  const { team0Level, team1Level } = props.state;
  if (team0Level === null || team1Level === null) return null;
  return labels.value.team0 + " " + formatTimelineLevel(team0Level) + " — " + formatTimelineLevel(team1Level) + " " + labels.value.team1;
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

const killersLabel = computed(() => {
  const victim = props.focus?.victim;
  if (!victim) return null;
  if (victim.killerNames.length > 0) return "Tué par " + victim.killerNames.join(", ");
  if (victim.killType === "other") return "Mort hors combat (créatures, tour, cœur…)";
  return "Tueurs non enregistrés pour cette mort";
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
  <div class="rounded-lg border border-border bg-surface p-3 text-sm">
    <div class="flex flex-wrap items-center gap-2">
      <span class="font-heading text-base font-semibold">à {{ formatDuration(seconds) }}</span>
      <span v-if="levelLabel" class="rounded-md border border-border px-2 py-0.5 text-xs text-muted">{{ levelLabel }}</span>
      <span v-if="leadLabel" class="rounded-md border border-border px-2 py-0.5 text-xs text-muted">{{ leadLabel }}</span>
      <span v-if="!levelLabel" class="rounded-md border border-border px-2 py-0.5 text-xs text-muted">
        Niveaux inconnus à cet instant
      </span>
    </div>

    <div v-if="focus" class="mt-3 rounded-md border border-border bg-elevated/40 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="inline-block h-2.5 w-2.5 rounded-full"
          :style="{ background: teamColors[focus.victim.team] }"
        />
        <span class="font-medium">{{ focus.victim.heroName ?? focus.victim.battletag }}</span>
        <span class="text-xs text-muted">
          {{ teamLabel(focus.victim.team) }}<template v-if="victimLane?.isMe"> · moi</template>
        </span>
        <span v-if="killTypeLabel" class="rounded-md border border-border px-2 py-0.5 text-xs text-muted">
          {{ killTypeLabel }}
        </span>
      </div>
      <p class="mt-1 text-xs text-muted">{{ killersLabel }}</p>
      <div v-if="fightOthers.length > 0" class="mt-2 border-t border-border pt-2 text-xs text-muted">
        Même escarmouche :
        <span v-for="(death, index) in fightOthers" :key="death.battletag + '-' + death.atSeconds">
          <template v-if="index > 0">, </template>
          {{ death.heroName ?? death.battletag }} ({{ teamLabel(death.team) }}) à {{ formatDuration(death.atSeconds) }}
        </span>
      </div>
    </div>

    <div v-if="hasRail" class="mt-3 border-t border-border pt-2">
      <p class="mb-1 text-[11px] uppercase tracking-wide text-muted">Autour de cet instant</p>
      <ul class="space-y-0.5">
        <li v-if="around.previous">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs text-muted transition-colors hover:bg-elevated/40 hover:text-foreground"
            @click="emit('seek', around.previous!.atSeconds)"
          >
            <UIcon name="i-heroicons-arrow-left" class="h-3 w-3 shrink-0" />
            <span class="tabular-nums">{{ formatDuration(around.previous.atSeconds) }}</span>
            <span class="truncate">{{ timelineEventLabel(around.previous) }}</span>
          </button>
        </li>
        <li v-for="event in around.upcoming" :key="event.kind + '-' + event.atSeconds">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs text-muted transition-colors hover:bg-elevated/40 hover:text-foreground"
            @click="emit('seek', event.atSeconds)"
          >
            <UIcon name="i-heroicons-arrow-right" class="h-3 w-3 shrink-0" />
            <span class="tabular-nums">{{ formatDuration(event.atSeconds) }}</span>
            <span class="truncate">{{ timelineEventLabel(event) }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
