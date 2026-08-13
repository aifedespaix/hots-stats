<script setup lang="ts">
import type { MapDetailResponse } from "~/types/maps";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const mapId = route.params.mapId as string;

const { data, error } = await useApiFetch<MapDetailResponse>(`/maps/${mapId}`);

const mapName = computed(() => data.value?.mapName ?? "Carte");

useSeoMeta({
  title: () => mapName.value,
  description: () => `Méta, ton historique et ton impact d'équipe sur ${mapName.value} (Heroes of the Storm).`,
  ogTitle: () => `${mapName.value} - HotS Analytics`,
  ogImage: "/og/maps-[mapId].png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/maps-[mapId].png",
  robots: "noindex, follow",
});

const themeColor = useChartThemeColor();

const metaSearch = ref("");
const { sortKey: metaSortKey, sortDir: metaSortDir, onSort: onMetaSort } = useSortState<string>("winrate", "desc");
const filteredMeta = computed(() => {
  const term = metaSearch.value.trim().toLowerCase();
  const rows = (data.value?.metaHeroes ?? []).filter((h) => (term ? h.heroName.toLowerCase().includes(term) : true));
  const dir = metaSortDir.value === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[metaSortKey.value as keyof typeof a];
    const bv = b[metaSortKey.value as keyof typeof b];
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
    return ((av as number) - (bv as number)) * dir;
  });
});
const metaColumns = [
  { key: "heroName", label: "Héros", sortable: true },
  { key: "heroRole", label: "Rôle", sortable: true },
  { key: "winrate", label: "Winrate", numeric: true, sortable: true },
  { key: "pickRate", label: "Pickrate", numeric: true, sortable: true },
  { key: "gamesPlayed", label: "Parties", numeric: true, sortable: true },
];

const personalColumns = [
  { key: "heroName", label: "Héros", sortable: true },
  { key: "gamesPlayed", label: "Parties", numeric: true, sortable: true },
  { key: "winrate", label: "Winrate", numeric: true, sortable: true },
  { key: "kda", label: "KDA", numeric: true },
];

function goToTalents(heroId: string) {
  navigateTo({ path: "/talents", query: { heroId, mapId } });
}

const teamImpactChartData = computed(() => {
  const impact = data.value?.teamImpact;
  return {
    labels: (impact?.components ?? []).map((c) => c.label),
    datasets: [
      {
        label: "Impact d'équipe",
        data: (impact?.components ?? []).map((c) => c.percentile),
        borderColor: themeColor("--color-primary"),
        backgroundColor: themeColor("--color-primary", 0.25),
        pointBackgroundColor: themeColor("--color-primary"),
        pointRadius: 3,
        borderWidth: 2,
      },
    ],
  };
});

const teamImpactChartOptions = computed(() => ({
  scales: {
    r: {
      min: 0,
      max: 100,
      ticks: { display: false, stepSize: 25 },
      grid: { color: themeColor("--color-border") },
      angleLines: { color: themeColor("--color-border") },
      pointLabels: { color: themeColor("--color-foreground"), font: { size: 11 } },
    },
  },
  plugins: { legend: { display: false } },
}));

function soakBarWidth(winrate: number): string {
  return `${Math.round(winrate * 100)}%`;
}
</script>

<template>
  <div v-if="error" class="rounded-lg border border-border bg-surface p-8 text-center text-muted">
    Carte introuvable.
  </div>

  <div v-else-if="data" class="space-y-8">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <NuxtLink to="/maps" class="text-sm text-brand hover:underline">&larr; Retour aux cartes</NuxtLink>
        <h1 class="mt-2 font-heading text-2xl font-semibold">{{ data.mapName }}</h1>
      </div>
      <UButton :to="`/talents?mapId=${mapId}`" color="gray" variant="soft" icon="i-heroicons-sparkles" size="sm">
        Talents forts sur cette carte
      </UButton>
    </div>

    <StatsFormTrackerWidget
      :context="{ mapId }"
      title="Forme récente sur cette carte"
      :modal-description="`Winrate sur ${data.mapName}, selon la fenêtre choisie ci-dessous.`"
    />

    <!-- A. Méta globale -->
    <UiPanel
      v-model:search="metaSearch"
      title="Méta globale sur cette carte"
      :count="filteredMeta.length"
      search-placeholder="Rechercher un héros"
    >
      <UiDataTable
        :columns="metaColumns"
        :rows="filteredMeta"
        row-key="heroId"
        clickable
        mobile-secondary-key="heroRole"
        mobile-badge-key="winrate"
        :sort-key="metaSortKey"
        :sort-dir="metaSortDir"
        @sort="onMetaSort"
        @row-click="(row) => goToTalents(row.heroId as string)"
      >
        <template #cell-heroRole="{ row }">{{ formatHeroRole(row.heroRole as string | null) }}</template>
        <template #cell-winrate="{ row }">
          <span :class="(row.winrate as number) >= 0.5 ? 'text-success' : 'text-danger'">
            {{ formatPercent(row.winrate as number) }}
          </span>
        </template>
        <template #cell-pickRate="{ row }">{{ formatPercent(row.pickRate as number) }}</template>
      </UiDataTable>
      <p class="mt-3 text-xs text-muted">
        Toutes les parties classées enregistrées par l'application, au moins 10 parties par héros. Clique une ligne
        pour analyser ses talents sur cette carte.
      </p>
    </UiPanel>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- B. Mes stats -->
      <div class="rounded-lg border border-border bg-surface p-4">
        <h2 class="mb-3 font-heading text-sm font-medium">Mes stats sur cette carte</h2>
        <div v-if="data.personalRanking.gamesPlayed === 0" class="text-sm text-muted">
          Pas encore de partie classée sur cette carte.
        </div>
        <div v-else class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <UiStatTile
              label="Winrate ici"
              :value="formatPercent(data.personalRanking.winrate)"
              :tone="data.personalRanking.winrate >= 0.5 ? 'success' : 'danger'"
              :sublabel="`${data.personalRanking.gamesPlayed} parties`"
            />
            <UiStatTile
              label="Classement"
              :value="data.personalRanking.rank ? `${data.personalRanking.rank}e / ${data.personalRanking.totalRankedMaps}` : '-'"
              sublabel="parmi tes cartes jouées"
            />
          </div>
          <div class="grid grid-cols-2 gap-3 text-xs">
            <div v-if="data.personalRanking.bestMap" class="rounded-md bg-success/10 p-2.5">
              <p class="text-muted">Meilleure carte</p>
              <p class="font-medium text-success">
                {{ data.personalRanking.bestMap.mapName }} - {{ formatPercent(data.personalRanking.bestMap.winrate) }}
              </p>
            </div>
            <div v-if="data.personalRanking.worstMap" class="rounded-md bg-danger/10 p-2.5">
              <p class="text-muted">Pire carte</p>
              <p class="font-medium text-danger">
                {{ data.personalRanking.worstMap.mapName }} - {{ formatPercent(data.personalRanking.worstMap.winrate) }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- C. Mes héros ici -->
      <div class="rounded-lg border border-border bg-surface p-4">
        <h2 class="mb-3 font-heading text-sm font-medium">Mes héros sur cette carte</h2>
        <UiDataTable :columns="personalColumns" :rows="data.personalHeroes" row-key="heroId" mobile-badge-key="winrate">
          <template #cell-winrate="{ row }">
            <span :class="(row.winrate as number) >= 0.5 ? 'text-success' : 'text-danger'">
              {{ formatPercent(row.winrate as number) }}
            </span>
          </template>
          <template #cell-kda="{ row }">
            {{ formatAvg(row.avgKills as number) }} / {{ formatAvg(row.avgDeaths as number) }} /
            {{ formatAvg(row.avgAssists as number) }}
          </template>
        </UiDataTable>
      </div>
    </div>

    <!-- D. Impact d'équipe -->
    <div class="rounded-lg border border-border bg-surface p-4">
      <div class="mb-3 flex items-center gap-1.5">
        <h2 class="font-heading text-sm font-medium">Impact d'équipe sur cette carte</h2>
        <UTooltip :popper="{ placement: 'top' }">
          <template #text>
            <div class="max-w-xs space-y-1.5 py-0.5 text-left text-xs leading-relaxed">
              <p>
                Participation aux kills, XP générée, survie et une stat propre à ton rôle (dégâts, soins ou dégâts
                encaissés selon le cas), comparées aux autres joueurs de ton rôle dominant sur cette carte.
              </p>
              <p class="text-muted">Version phase 1 : proxy calculé sur les stats de fin de partie, pas encore sur les combats isolés.</p>
            </div>
          </template>
          <UIcon name="i-heroicons-information-circle" class="h-3.5 w-3.5 cursor-help text-muted/70 hover:text-brand" />
        </UTooltip>
      </div>

      <div v-if="!data.teamImpact" class="text-sm text-muted">
        Pas encore assez de parties classées dans ton rôle principal sur cette carte pour calculer ce score.
      </div>
      <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-[auto,1fr] sm:items-center">
        <UiStatTile
          label="Score d'impact"
          :value="`${data.teamImpact.score} / 100`"
          :tone="data.teamImpact.score >= 50 ? 'success' : 'danger'"
          :sublabel="`Rôle ${formatHeroRole(data.teamImpact.role)} · ${data.teamImpact.gamesPlayed} parties`"
        />
        <div class="h-56">
          <ChartsRadarChart :data="teamImpactChartData" :options="teamImpactChartOptions" />
        </div>
      </div>
    </div>

    <!-- E. Winrate par niveau de soak -->
    <div class="rounded-lg border border-border bg-surface p-4">
      <div class="mb-3 flex items-center gap-1.5">
        <h2 class="font-heading text-sm font-medium">Winrate par niveau de soak</h2>
        <UTooltip :popper="{ placement: 'top' }">
          <template #text>
            <div class="max-w-xs space-y-1.5 py-0.5 text-left text-xs leading-relaxed">
              <p>
                Indicateur relatif : XP générée par minute comparée à ta participation aux kills, sur tes propres
                parties classées sur cette carte. "Fort soak" = XP élevée malgré peu de participation aux kills.
              </p>
              <p class="text-muted">Proxy en attendant la ventilation exacte de l'XP par source côté données.</p>
            </div>
          </template>
          <UIcon name="i-heroicons-information-circle" class="h-3.5 w-3.5 cursor-help text-muted/70 hover:text-brand" />
        </UTooltip>
      </div>

      <div v-if="!data.soak" class="text-sm text-muted">
        Pas encore assez de parties classées sur cette carte pour découper ton soak en tranches fiables.
      </div>
      <ol v-else class="space-y-3">
        <li v-for="bucket in data.soak.buckets" :key="bucket.label" class="text-sm">
          <div class="mb-1 flex items-center justify-between gap-2">
            <span class="font-medium">{{ bucket.label }}</span>
            <span class="shrink-0 font-mono text-xs text-muted">
              {{ formatPercent(bucket.winrate) }} · {{ bucket.gamesPlayed }} partie{{ bucket.gamesPlayed > 1 ? "s" : "" }}
            </span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-background">
            <div
              class="h-full rounded-full"
              :class="bucket.winrate >= 0.5 ? 'bg-success' : 'bg-danger'"
              :style="{ width: soakBarWidth(bucket.winrate) }"
            />
          </div>
        </li>
      </ol>
    </div>
  </div>
</template>
