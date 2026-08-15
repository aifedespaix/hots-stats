<script setup lang="ts">
import type { MatchDetailResponse } from "~/types/matches";
import type { ScoreboardRow } from "~/types/coach";

definePageMeta({ middleware: "auth" });

const route = useRoute();

const { data, error } = await useApiFetch<MatchDetailResponse>(`/matches/${route.params.id}`);
const { data: authData } = useAuthUser();

const matchTitle = computed(() => data.value?.match.mapName ?? "Game Coach");
const matchSeoDescription = computed(() =>
  data.value
    ? `Scoreboard enrichi et analyse Coach de la partie sur ${data.value.match.mapName} : KDA, participation aux kills, talents et diagnostics de combat.`
    : "Scoreboard enrichi et analyse Coach d'une partie Heroes of the Storm.",
);

useSeoMeta({
  title: () => matchTitle.value,
  description: () => matchSeoDescription.value,
  ogTitle: () => `${matchTitle.value} - HotS Analytics`,
  ogDescription: () => matchSeoDescription.value,
  ogImage: "/og/matches-[id].png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/matches-[id].png",
  robots: "noindex, follow",
});

const myBattletag = computed(() => authData.value?.user?.battletag ?? null);
const allPlayers = computed(() => data.value?.teams.flatMap((team) => team.players) ?? []);

const annotationsStore = usePlayerAnnotationsStore();
watch(
  allPlayers,
  (players) => {
    if (players.length > 0) annotationsStore.fetchMany(players.map((player) => player.battletag));
  },
  { immediate: true },
);

const tabItems = [
  { label: "Statistiques & Scoreboard", icon: "i-heroicons-table-cells", slot: "scoreboard" as const },
  { label: "Le Coach", icon: "i-heroicons-light-bulb", slot: "coach" as const },
  { label: "Heatmaps & Placement", icon: "i-heroicons-viewfinder-circle", slot: "heatmaps" as const },
];

// --- Tab 1: enriched scoreboard -------------------------------------------

const scoreboardRows = computed(() => buildScoreboardRows(allPlayers.value, myBattletag.value));
const performerBadges = computed(() => topPerformerBadges(scoreboardRows.value));
const viewerAllyRows = computed(() => scoreboardRows.value.filter((r) => r.isAlly));
const viewerEnemyRows = computed(() => scoreboardRows.value.filter((r) => !r.isAlly));

/** Default sort: me, then my teammates, then opponents. */
function rank(row: ScoreboardRow): number {
  if (row.isMe) return 0;
  return row.isAlly ? 1 : 2;
}

type SortableColumn =
  | "battletag"
  | "heroName"
  | "kills"
  | "deaths"
  | "assists"
  | "killParticipation"
  | "damagePerDeath"
  | "heroDamage"
  | "siegeDamage"
  | "healing"
  | "xpShare"
  | "damageTaken";

const { sortKey, sortDir, onSort } = useSortState<SortableColumn | "default">("default", "desc");

const sortedRows = computed(() => {
  const rows = [...scoreboardRows.value];
  const key = sortKey.value;
  if (key === "default") return rows.sort((a, b) => rank(a) - rank(b));
  return sortByKey(rows, key, sortDir.value);
});

// --- Tab 2: Coach insights, for whichever of the 10 players is selected ---

const selectedBattletag = ref<string | null>(null);
watch(
  scoreboardRows,
  (rows) => {
    if (selectedBattletag.value && rows.some((r) => r.battletag === selectedBattletag.value)) return;
    selectedBattletag.value = rows.find((r) => r.isMe)?.battletag ?? rows[0]?.battletag ?? null;
  },
  { immediate: true },
);

const selectedRow = computed(() => scoreboardRows.value.find((r) => r.battletag === selectedBattletag.value) ?? null);
const subjectTeamRows = computed(() =>
  selectedRow.value ? scoreboardRows.value.filter((r) => r.team === selectedRow.value!.team) : [],
);
const subjectEnemyRows = computed(() =>
  selectedRow.value ? scoreboardRows.value.filter((r) => r.team !== selectedRow.value!.team) : [],
);

const coachInsights = computed(() => {
  if (!selectedRow.value) return [];
  return buildCoachInsights({
    me: selectedRow.value,
    myTeam: subjectTeamRows.value,
    enemyTeam: subjectEnemyRows.value,
    timeline: data.value?.timeline ?? null,
  });
});

// Ready verdicts first: today every timeline-dependent pillar shows
// "unavailable" (see coachAnalysis.ts), so leading with what's actually
// actionable avoids burying the two real insights at the bottom of the grid.
const displayedInsights = computed(() =>
  [...coachInsights.value].sort((a, b) => Number(a.status !== "ready") - Number(b.status !== "ready")),
);
</script>

<template>
  <UiErrorState v-if="error" :status-code="404" message="Partie introuvable." back-to="/matches" back-label="Retour à l'historique" />

  <div v-else-if="data" class="space-y-6">
    <div>
      <NuxtLink to="/matches" class="text-sm text-brand hover:underline">
        &larr; Retour à l'historique
      </NuxtLink>
      <h1 class="mt-2 font-heading text-2xl font-semibold">{{ data.match.mapName }}</h1>
      <p class="mt-1 text-sm text-muted">
        {{ formatGameMode(data.match.gameMode) }} · {{ formatDate(data.match.playedAt) }} ·
        {{ formatDuration(data.match.durationSeconds) }} · {{ data.match.region }}
      </p>
    </div>

    <UTabs :items="tabItems" variant="pill" class="w-full">
      <template #scoreboard>
        <div class="mt-4 space-y-6">
          <CoachTeamTotalsBar :my-team="viewerAllyRows" :enemy-team="viewerEnemyRows" />

          <CoachScoreboardTable
            :rows="sortedRows"
            :badges="performerBadges"
            :sort-key="sortKey"
            :sort-dir="sortDir"
            @sort="onSort"
          />

          <CoachPlayerTalents :players="sortedRows" />
        </div>
      </template>

      <template #coach>
        <div class="mt-4 space-y-4">
          <CoachPlayerSwitcher
            v-if="selectedBattletag"
            :players="scoreboardRows"
            :model-value="selectedBattletag"
            @update:model-value="selectedBattletag = $event"
          />

          <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <CoachInsightCard v-for="insight in displayedInsights" :key="insight.pillar" :insight="insight" />
          </div>
        </div>
      </template>

      <template #heatmaps>
        <div class="mt-4">
          <CoachHeatmapsPlaceholder />
        </div>
      </template>
    </UTabs>
  </div>
</template>
