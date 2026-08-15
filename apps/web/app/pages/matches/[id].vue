<script setup lang="ts">
import type { MatchDetailPlayer, MatchDetailResponse } from "~/types/matches";

definePageMeta({ middleware: "auth" });

const route = useRoute();

const { data, error } = await useApiFetch<MatchDetailResponse>(`/matches/${route.params.id}`);
const { data: authData } = useAuthUser();

const talentTiers = [1, 4, 7, 10, 13, 16, 20] as const;

const matchTitle = computed(() => data.value?.match.mapName ?? "Détails de la partie");
const matchSeoDescription = computed(() =>
  data.value
    ? `Détails de la partie sur ${data.value.match.mapName} : composition des équipes, KDA et talents joués.`
    : "Détails d'une partie Heroes of the Storm : composition des équipes, KDA et talents joués.",
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
const myTeam = computed(
  () => allPlayers.value.find((player) => player.battletag === myBattletag.value)?.team ?? null,
);

function isMe(player: MatchDetailPlayer): boolean {
  return player.battletag === myBattletag.value;
}

function isAlly(player: MatchDetailPlayer): boolean {
  return myTeam.value !== null && player.team === myTeam.value;
}

const annotationsStore = usePlayerAnnotationsStore();
watch(
  allPlayers,
  (players) => {
    if (players.length > 0) annotationsStore.fetchMany(players.map((player) => player.battletag));
  },
  { immediate: true },
);

/** Priority order for the default sort: me, then my teammates, then opponents. */
function rank(player: MatchDetailPlayer): number {
  if (isMe(player)) return 0;
  return isAlly(player) ? 1 : 2;
}

type SortableColumn =
  | "battletag"
  | "heroName"
  | "kills"
  | "deaths"
  | "assists"
  | "heroDamage"
  | "siegeDamage"
  | "healing"
  | "selfHealing"
  | "experienceContribution"
  | "damageTaken";

const { sortKey, sortDir, onSort } = useSortState<SortableColumn | "default">("default", "desc");

const sortedPlayers = computed(() => {
  const players = [...allPlayers.value];
  const key = sortKey.value;
  if (key === "default") {
    return players.sort((a, b) => rank(a) - rank(b));
  }
  return sortByKey(players, key, sortDir.value);
});

function rowClass(row: Record<string, unknown>): string {
  const player = row as unknown as MatchDetailPlayer;
  const teamClass = isAlly(player)
    ? "bg-info/10 hover:bg-info/15"
    : "bg-danger/10 hover:bg-danger/15";
  return isMe(player) ? `${teamClass} ring-1 ring-inset ring-brand` : teamClass;
}

const columns = [
  { key: "heroName", label: "Héros", sortable: true },
  { key: "battletag", label: "Joueur", sortable: true },
  { key: "kills", label: "Kills", numeric: true, sortable: true },
  { key: "assists", label: "Assists", numeric: true, sortable: true },
  { key: "deaths", label: "Morts", numeric: true, sortable: true },
  { key: "siegeDamage", label: "Dégâts siège", numeric: true, sortable: true },
  { key: "heroDamage", label: "Dégâts héros", numeric: true, sortable: true },
  { key: "healing", label: "Soin", numeric: true, sortable: true },
  { key: "selfHealing", label: "Auto-soin", numeric: true, sortable: true },
  { key: "experienceContribution", label: "Contribution XP", numeric: true, sortable: true },
  { key: "damageTaken", label: "Dégâts subis", numeric: true, sortable: true },
];
</script>

<template>
  <UiErrorState v-if="error" :status-code="404" message="Partie introuvable." back-to="/matches" back-label="Retour à l'historique" />

  <div v-else-if="data" class="space-y-8">
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

    <UiDataTable
      :columns="columns"
      :rows="sortedPlayers"
      :sort-key="sortKey"
      :sort-dir="sortDir"
      :row-class="rowClass"
      mobile-primary-key="heroName"
      mobile-secondary-key="battletag"
      @sort="onSort"
    >
      <template #cell-heroName="{ row }">
        <span class="font-medium">{{ row.heroName }}</span>
        <span class="ml-1 text-xs text-muted">{{ (row as unknown as MatchDetailPlayer).heroRole }}</span>
      </template>
      <template #cell-battletag="{ row }">
        <div class="flex items-center gap-2">
          <NuxtLink
            v-if="!isMe(row as unknown as MatchDetailPlayer)"
            :to="`/players/${encodeURIComponent(row.battletag as string)}`"
            class="font-mono underline-offset-2 hover:underline"
          >
            {{ row.battletag }}
          </NuxtLink>
          <span v-else class="font-mono">{{ row.battletag }}</span>
          <PlayersAnnotationBadges :battletag="row.battletag as string" />
        </div>
      </template>
      <template #cell-heroDamage="{ row }">{{ (row.heroDamage as number).toLocaleString() }}</template>
      <template #cell-siegeDamage="{ row }">{{ (row.siegeDamage as number).toLocaleString() }}</template>
      <template #cell-healing="{ row }">{{ (row.healing as number).toLocaleString() }}</template>
      <template #cell-selfHealing="{ row }">{{ (row.selfHealing as number).toLocaleString() }}</template>
      <template #cell-experienceContribution="{ row }">
        {{ (row.experienceContribution as number).toLocaleString() }}
      </template>
      <template #cell-damageTaken="{ row }">{{ (row.damageTaken as number).toLocaleString() }}</template>
    </UiDataTable>

    <div class="space-y-3">
      <h2 class="font-heading text-lg font-medium">Talents</h2>
      <div
        v-for="player in sortedPlayers"
        :key="player.id"
        class="rounded-lg border border-border bg-surface p-4"
      >
        <p class="text-sm font-medium">
          {{ player.heroName }} <span class="font-mono text-xs text-muted">({{ player.battletag }})</span>
        </p>
        <div v-if="player.talents.length > 0" class="mt-2 flex flex-wrap gap-2">
          <div v-for="tier in talentTiers" :key="tier" class="rounded border border-border px-2 py-1 text-xs">
            <span class="text-muted">{{ tier }}:</span>
            {{ formatTalentName(player.talents.find((t) => t.tier === tier)?.talentName ?? "-", player.heroName) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
