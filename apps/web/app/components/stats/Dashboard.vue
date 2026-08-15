<script setup lang="ts">
import type { MatchesDashboardResponse } from "~/types/matches";

/**
 * Drop-in "Dashboard" section: 4 KPI cards + a chart launcher row, all
 * recomputed from a single `/matches/dashboard` request whenever `filters`
 * changes. Composed entirely from the generic `stats/*` and `charts/*`
 * components, so the whole section is just as importable on another page
 * (e.g. Diagnostic) as `<StatsDashboard :filters="..." />`.
 */
const props = defineProps<{ filters: Record<string, unknown> }>();

const query = computed(() => props.filters);
const { data, pending } = useApiFetch<MatchesDashboardResponse>("/matches/dashboard", { query });

const MIN_MAP_SAMPLE = 2;

/** Best/worst 3 maps by winrate, preferring maps with at least `MIN_MAP_SAMPLE`
 * games so a single lucky/unlucky game doesn't dominate the ranking, and
 * keeping the two lists disjoint when there are enough maps to do so. */
function rankMaps(maps: MatchesDashboardResponse["maps"]) {
  const sampled = maps.filter((m) => m.gamesPlayed >= MIN_MAP_SAMPLE);
  const pool = sampled.length >= 3 ? sampled : maps;

  const best = [...pool].sort((a, b) => b.winrate - a.winrate || b.gamesPlayed - a.gamesPlayed).slice(0, 3);
  const bestIds = new Set(best.map((m) => m.mapId));
  const worstSorted = [...pool].sort((a, b) => a.winrate - b.winrate || b.gamesPlayed - a.gamesPlayed);
  const distinct = worstSorted.filter((m) => !bestIds.has(m.mapId));

  return { best, worst: (distinct.length >= 3 ? distinct : worstSorted).slice(0, 3) };
}

const rankedMaps = computed(() => rankMaps(data.value?.maps ?? []));

function gamesLabel(count: number): string {
  return `${count} partie${count > 1 ? "s" : ""}`;
}

const roleItems = computed(() =>
  (data.value?.roles ?? []).slice(0, 3).map((role) => ({
    id: role.role ?? "unknown",
    label: formatHeroRole(role.role),
    value: formatPercent(role.winrate),
    valueSub: gamesLabel(role.gamesPlayed),
    icon: heroRoleIcon(role.role),
  })),
);

const heroItems = computed(() =>
  (data.value?.heroes ?? []).slice(0, 3).map((hero) => ({
    id: hero.heroId,
    label: hero.heroName,
    sublabel: formatHeroRole(hero.heroRole),
    value: formatPercent(hero.winrate),
    valueSub: gamesLabel(hero.gamesPlayed),
    avatarLabel: initials(hero.heroName),
  })),
);

function mapItems(maps: MatchesDashboardResponse["maps"]) {
  return maps.map((map) => ({
    id: map.mapId,
    label: map.mapName,
    icon: "i-heroicons-map",
    value: formatPercent(map.winrate),
    valueSub: gamesLabel(map.gamesPlayed),
  }));
}

const bestMapItems = computed(() => mapItems(rankedMaps.value.best));
const worstMapItems = computed(() => mapItems(rankedMaps.value.worst));

const winrateTone = computed(() => ((data.value?.overview.winrate ?? 0) >= 0.5 ? "success" : "danger"));
const kdaTone = computed(() => {
  const kda = data.value?.overview.kda;
  if (kda === null || kda === undefined) return "success";
  return kda >= 1 ? "success" : "danger";
});
</script>

<template>
  <section class="space-y-4">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatsStatCard
        title="Vue d'ensemble"
        icon="i-heroicons-squares-2x2"
        tone="primary"
        :loading="pending && !data"
        :value="data ? String(data.overview.gamesPlayed) : undefined"
        :value-sub="data ? `${data.overview.wins}V / ${data.overview.losses}D` : undefined"
      >
        <div class="space-y-1.5">
          <StatsMiniStat
            icon="i-heroicons-trophy"
            label="Winrate"
            :value="data ? formatPercent(data.overview.winrate) : '-'"
            :tone="winrateTone"
          />
          <StatsMiniStat
            icon="i-heroicons-bolt"
            label="Ratio KDA"
            :value="data ? formatKda(data.overview.kda) : '-'"
            :tone="kdaTone"
          />
        </div>
      </StatsStatCard>

      <StatsStatCard title="Rôles favoris" icon="i-heroicons-user-group" tone="accent" :loading="pending && !data">
        <StatsRankBadgeList :items="roleItems" empty-text="Aucun rôle sur ces filtres." />
      </StatsStatCard>

      <StatsStatCard title="Héros favoris" icon="i-heroicons-fire" tone="success" :loading="pending && !data">
        <StatsRankBadgeList :items="heroItems" empty-text="Aucun héros sur ces filtres." />
      </StatsStatCard>

      <StatsStatCard title="Analyse des cartes" icon="i-heroicons-map" tone="danger" :loading="pending && !data">
        <div class="space-y-3">
          <div>
            <p class="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-success">
              <UIcon name="i-heroicons-arrow-trending-up" class="h-3.5 w-3.5" />
              Meilleures cartes
            </p>
            <StatsRankBadgeList :items="bestMapItems" tone="success" dense empty-text="Pas assez de données." />
          </div>
          <div>
            <p class="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-danger">
              <UIcon name="i-heroicons-arrow-trending-down" class="h-3.5 w-3.5" />
              Cartes à travailler
            </p>
            <StatsRankBadgeList :items="worstMapItems" tone="danger" dense empty-text="Pas assez de données." />
          </div>
        </div>
      </StatsStatCard>
    </div>

    <StatsChartLauncherGroup
      :filters="filters"
      :roles="data?.roles ?? []"
      :maps="data?.maps ?? []"
      :performance="data?.performance"
    />
  </section>
</template>
