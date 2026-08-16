<script setup lang="ts">
import type { MatchDetailResponse } from "~/types/matches";
import type { ScoreboardRow } from "~/types/coach";
import type { MatchSlotHero } from "~/types/spatial";

definePageMeta({ middleware: "auth" });

const route = useRoute();

// This endpoint returns one specific match by id and ignores `mode`
// entirely server-side, so it must opt out of useApiFetch's default game-mode
// query injection. Leaving it on made the fetch's auto-generated key reactive
// to the persisted (localStorage-only) game-mode filter: whenever that
// filter differs from the SSR default the moment it's restored client-side,
// Nuxt treats it as a different request, discards the SSR-fetched payload,
// and refetches from scratch right after hydration -- on a hard reload that
// briefly (or, combined with this app's hydration-patch issues, sometimes
// permanently) shows the "Partie introuvable" error state before the refetch
// resolves.
const { data, error } = await useApiFetch<MatchDetailResponse>(`/matches/${route.params.id}`, {
  withGameMode: false,
});
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
  { label: "Heatmaps & Placement", icon: "i-heroicons-viewfinder-circle", slot: "heatmaps" as const },
];

// --- Tab 1: enriched scoreboard -------------------------------------------

const scoreboardRows = computed(() => buildScoreboardRows(allPlayers.value, myBattletag.value));
const performerBadges = computed(() => topPerformerBadges(scoreboardRows.value));
const viewerAllyRows = computed(() => scoreboardRows.value.filter((r) => r.isAlly));
const viewerEnemyRows = computed(() => scoreboardRows.value.filter((r) => !r.isAlly));

// --- Tab 2: spatial analysis ------------------------------------------------

const spatialGrid = computed(() => data.value?.spatial?.grid ?? null);
const spatialMatchHeroes = computed<MatchSlotHero[]>(() => {
  const spatial = data.value?.spatial;
  if (!spatial) return [];
  const rowById = new Map(scoreboardRows.value.map((row) => [row.id, row]));
  return spatial.heroes.flatMap((hero) => {
    const row = rowById.get(hero.matchPlayerId);
    if (!row) return [];
    return [
      {
        matchPlayerId: hero.matchPlayerId,
        battletag: row.battletag,
        heroId: row.heroId,
        heroName: row.heroName,
        team: row.team,
        isAlly: row.isAlly,
        presence: hero.presence,
        kills: hero.kills,
        deaths: hero.deaths,
      },
    ];
  });
});

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

// --- Coach insights modal, opened by clicking a hero row in the scoreboard ---

const selectedBattletag = ref<string | null>(null);
const coachModalOpen = ref(false);

function openCoachModal(battletag: string) {
  selectedBattletag.value = battletag;
  coachModalOpen.value = true;
}

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

// Ready verdicts first: a match ingested before the daemon started sending
// `timeline` data has every timeline-dependent pillar as "unavailable" (see
// coachAnalysis.ts), so leading with what's actually actionable avoids
// burying the ready insights at the bottom of the grid.
const displayedInsights = computed(() =>
  [...coachInsights.value].sort((a, b) => Number(a.status !== "ready") - Number(b.status !== "ready")),
);
</script>

<template>
  <UiErrorState v-if="error" :status-code="404" message="Partie introuvable." back-to="/matches" back-label="Retour à l'historique" />

  <div v-else-if="data" class="space-y-6">
    <div>
      <UiBackLink to="/matches" label="Retour à l'historique" />
      <h1 class="mt-2 font-heading text-2xl font-semibold">{{ data.match.mapName }}</h1>
      <p class="mt-1 text-sm text-muted">
        {{ formatGameMode(data.match.gameMode) }} · {{ formatDate(data.match.playedAt) }} ·
        {{ formatDuration(data.match.durationSeconds) }} · {{ data.match.region }}
      </p>
    </div>

    <UAlert
      v-if="!data.statsReliable"
      color="warning"
      variant="subtle"
      icon="i-heroicons-exclamation-triangle"
      title="Statistiques potentiellement incorrectes"
      description="Cette partie a été analysée par une ancienne version du parseur, qui pouvait mal attribuer certaines stats de combat (dégâts, soins, XP figés à 0 ou dupliqués entre joueurs). Elle sera corrigée automatiquement à la prochaine synchronisation du daemon du joueur qui l'a envoyée, si le fichier de replay est encore présent sur son disque."
    />

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
            @select-player="openCoachModal"
          />

          <CoachPlayerTalents :players="sortedRows" />
        </div>
      </template>

      <template #heatmaps>
        <div class="mt-4">
          <SpatialMatchSlot
            v-if="spatialGrid && spatialMatchHeroes.length > 0"
            :map-id="data.match.mapId"
            :grid-cols="spatialGrid.cols"
            :grid-rows="spatialGrid.rows"
            :heroes="spatialMatchHeroes"
          />
          <CoachHeatmapsPlaceholder v-else :calibrated="data.spatialCalibrated" />
        </div>
      </template>
    </UTabs>

    <CoachInsightsModal
      v-model="coachModalOpen"
      :players="scoreboardRows"
      :selected-battletag="selectedBattletag"
      :insights="displayedInsights"
      @update:selected-battletag="selectedBattletag = $event"
    />
  </div>
</template>
