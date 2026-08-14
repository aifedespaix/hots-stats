<script setup lang="ts">
import { TALENT_ANALYZER_MIN_GAMES_DEFAULT, TALENT_TIERS } from "@hots-stats/shared-types";
import type { HeroListResponse } from "~/types/analytics";
import type { MapDetailResponse, MapHubResponse } from "~/types/maps";
import type { TalentAnalyzerResponse } from "~/types/talent-analyzer";

definePageMeta({ middleware: "auth" });

useSeoMeta({
  title: "Analyseur de talents",
  description: "Le build optimal d'un héros, sur une carte, ou les deux à la fois -- winrate conditionnel par palier.",
  ogTitle: "Analyseur de talents - HotS Analytics",
  ogImage: "/og/talents-index.png",
  twitterCard: "summary_large_image",
  twitterImage: "/og/talents-index.png",
  robots: "noindex, follow",
});

const route = useRoute();
const config = useRuntimeConfig();

const { scope, saving: scopeSaving, setScope } = useHeroStatsScope();

const heroId = ref((route.query.heroId as string) ?? "");
const mapId = ref((route.query.mapId as string) ?? "");
const minGames = ref(TALENT_ANALYZER_MIN_GAMES_DEFAULT);

const { data: heroesData } = await useApiFetch<HeroListResponse>("/heroes", { query: { scope: "global" } });
const { data: mapsData } = await useApiFetch<MapHubResponse>("/maps");

const heroOptions = computed(() => [
  { value: "", label: "-- aucun --" },
  ...(heroesData.value?.heroes ?? [])
    .map((h) => ({ value: h.heroId, label: h.heroName }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]);
const mapOptions = computed(() => [
  { value: "", label: "-- aucune --" },
  ...(mapsData.value?.maps ?? [])
    .map((m) => ({ value: m.mapId, label: m.mapName }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]);

const selectedHeroName = computed(() => heroesData.value?.heroes.find((h) => h.heroId === heroId.value)?.heroName ?? "");

type Mode = "hero" | "map" | "both";
const mode = computed<Mode>(() => {
  if (heroId.value && mapId.value) return "both";
  if (heroId.value) return "hero";
  return "map";
});
const modeLabel: Record<Mode, string> = {
  hero: "Héros seul -- build général, toutes cartes",
  map: "Carte seule -- héros les plus forts sur cette carte",
  both: "Héros + Carte -- build optimal sur cette carte précise",
};

// --- Pins: which talent is locked at which tier, narrowing the population every later tier is computed against ---
const pins = ref<Partial<Record<number, { talentId: string; talentName: string }>>>({});

function togglePin(tier: number, talentId: string, talentName: string) {
  if (pins.value[tier]?.talentId === talentId) {
    const next = { ...pins.value };
    delete next[tier];
    pins.value = next;
    return;
  }
  pins.value = { ...pins.value, [tier]: { talentId, talentName } };
}

function unpinTier(tier: number) {
  const next = { ...pins.value };
  delete next[tier];
  pins.value = next;
}

function resetPins() {
  pins.value = {};
}

watch([heroId, mapId], () => {
  resetPins();
});

const pinsQueryString = computed(() =>
  Object.entries(pins.value)
    .map(([tier, pin]) => `${tier}:${pin?.talentId}`)
    .join(","),
);

// --- Talent Analyzer fetch: client-only, driven by hero/map/scope/pins/reliability ---
const analyzerData = ref<TalentAnalyzerResponse | null>(null);
const analyzerPending = ref(false);

async function loadAnalyzer() {
  if (!heroId.value) {
    analyzerData.value = null;
    return;
  }
  analyzerPending.value = true;
  try {
    analyzerData.value = await $fetch<TalentAnalyzerResponse>("/talent-analyzer", {
      baseURL: config.public.apiBase,
      credentials: "include",
      query: {
        heroId: heroId.value,
        ...(mapId.value ? { mapId: mapId.value } : {}),
        scope: scope.value,
        ...(pinsQueryString.value ? { pins: pinsQueryString.value } : {}),
        minGames: minGames.value,
      },
    });
  } finally {
    analyzerPending.value = false;
  }
}

// --- "Carte seule" mode: reuse the map detail endpoint's meta-heroes list ---
const mapMetaData = ref<MapDetailResponse | null>(null);
const mapMetaPending = ref(false);

async function loadMapMeta() {
  if (heroId.value || !mapId.value) {
    mapMetaData.value = null;
    return;
  }
  mapMetaPending.value = true;
  try {
    mapMetaData.value = await $fetch<MapDetailResponse>(`/maps/${mapId.value}`, {
      baseURL: config.public.apiBase,
      credentials: "include",
    });
  } finally {
    mapMetaPending.value = false;
  }
}

if (import.meta.client) {
  watch([heroId, mapId, scope, pinsQueryString, minGames], loadAnalyzer, { immediate: true });
  watch([heroId, mapId], loadMapMeta, { immediate: true });
}

function pickHeroFromMeta(pickedHeroId: string) {
  heroId.value = pickedHeroId;
}

function tierData(tier: number) {
  return analyzerData.value?.tiers.find((t) => t.tier === tier) ?? null;
}

function pinnedOption(tier: number) {
  const pin = pins.value[tier];
  if (!pin) return null;
  return tierData(tier)?.options.find((o) => o.talentId === pin.talentId) ?? null;
}

const orderedPins = computed(() =>
  TALENT_TIERS.filter((tier) => pins.value[tier]).map((tier) => ({ tier, ...pins.value[tier]! })),
);

const buildColumns = [
  { key: "rank", label: "#" },
  { key: "build", label: "Build" },
  { key: "winrate", label: "Winrate", numeric: true, sortable: false },
  { key: "gamesPlayed", label: "Parties", numeric: true, sortable: false },
];

const buildRows = computed(() =>
  (analyzerData.value?.topBuilds ?? []).map((build, index) => ({
    id: `${index}`,
    rank: index + 1,
    build: build.picks.map((p) => formatTalentName(p.talentName, selectedHeroName.value)).join(" -> "),
    winrate: build.winrate,
    gamesPlayed: build.gamesPlayed,
    wilsonLowerBound: build.wilsonLowerBound,
    picks: build.picks,
  })),
);

function applyBuild(row: (typeof buildRows.value)[number]) {
  const next: Partial<Record<number, { talentId: string; talentName: string }>> = {};
  for (const pick of row.picks) next[pick.tier] = { talentId: pick.talentId, talentName: pick.talentName };
  pins.value = next;
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="font-heading text-2xl font-semibold">Analyseur de talents</h1>
      <p class="mt-1 text-sm text-muted">
        Choisis un héros, une carte, ou les deux -- épingle un talent à un palier pour recalculer la suite du build.
      </p>
    </div>

    <UiStatsScopeToggle
      :model-value="scope"
      :loading="scopeSaving"
      personal-description="Uniquement tes propres parties"
      @update:model-value="setScope"
    />

    <div class="rounded-lg border border-border bg-surface p-4">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label class="mb-1 block text-xs uppercase tracking-wide text-muted">Héros</label>
          <USelectMenu v-model="heroId" :options="heroOptions" value-attribute="value" option-attribute="label" searchable />
        </div>
        <div>
          <label class="mb-1 block text-xs uppercase tracking-wide text-muted">Carte</label>
          <USelectMenu v-model="mapId" :options="mapOptions" value-attribute="value" option-attribute="label" searchable />
        </div>
      </div>
      <p class="mt-3 text-xs text-muted">
        <UIcon name="i-heroicons-adjustments-horizontal" class="mr-1 inline h-3.5 w-3.5" />{{ modeLabel[mode] }}
        <span v-if="analyzerData && heroId"> -- {{ analyzerData.gamesPlayed }} parties correspondantes</span>
      </p>
    </div>

    <!-- Carte seule: pas de héros choisi -> table méta, chaque héros ouvre son board -->
    <div v-if="mode === 'map'">
      <div v-if="!mapId" class="rounded-lg border border-dashed border-border p-8 text-center text-muted">
        Choisis un héros, une carte, ou les deux pour démarrer une analyse.
      </div>
      <div v-else-if="mapMetaPending" class="rounded-lg border border-border bg-surface p-8 text-center text-muted">
        Chargement...
      </div>
      <UiPanel v-else title="Héros les plus forts sur cette carte" :count="mapMetaData?.metaHeroes.length">
        <UiDataTable
          :columns="[
            { key: 'heroName', label: 'Héros' },
            { key: 'heroRole', label: 'Rôle' },
            { key: 'winrate', label: 'Winrate', numeric: true },
            { key: 'pickRate', label: 'Pickrate', numeric: true },
            { key: 'gamesPlayed', label: 'Parties', numeric: true },
          ]"
          :rows="mapMetaData?.metaHeroes ?? []"
          row-key="heroId"
          clickable
          mobile-secondary-key="heroRole"
          mobile-badge-key="winrate"
          @row-click="(row) => pickHeroFromMeta(row.heroId as string)"
        >
          <template #cell-heroRole="{ row }">{{ formatHeroRole(row.heroRole as string | null) }}</template>
          <template #cell-winrate="{ row }">
            <span :class="(row.winrate as number) >= 0.5 ? 'text-success' : 'text-danger'">
              {{ formatPercent(row.winrate as number) }}
            </span>
          </template>
          <template #cell-pickRate="{ row }">{{ formatPercent(row.pickRate as number) }}</template>
        </UiDataTable>
        <p class="mt-3 text-xs text-muted">Clique un héros pour voir son board de talents sur cette carte.</p>
      </UiPanel>
    </div>

    <!-- Héros seul / Héros + carte: board de talents -->
    <template v-else>
      <!-- Fil du build -->
      <div v-if="orderedPins.length > 0" class="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
        <span class="text-xs uppercase tracking-wide text-muted">Build en cours</span>
        <template v-for="(pin, index) in orderedPins" :key="pin.tier">
          <UIcon v-if="index > 0" name="i-heroicons-arrow-right" class="h-3.5 w-3.5 text-muted" />
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-full bg-brand/15 px-2.5 py-1 text-xs font-medium text-brand"
            @click="unpinTier(pin.tier)"
          >
            <span>P{{ pin.tier }} -- {{ formatTalentName(pin.talentName, selectedHeroName) }}</span>
            <UIcon name="i-heroicons-x-mark" class="h-3 w-3" />
          </button>
        </template>
        <UButton size="2xs" color="gray" variant="soft" class="ml-auto" @click="resetPins">Réinitialiser</UButton>
      </div>

      <div v-if="!heroId" class="rounded-lg border border-dashed border-border p-8 text-center text-muted">
        Choisis un héros pour démarrer une analyse.
      </div>

      <template v-else>
        <!-- Fiabilité -->
        <div class="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-2 text-xs text-muted">
            <UIcon name="i-heroicons-shield-check" class="h-4 w-4" />
            Fiabilité stricte -- masque visuellement les talents joués moins de {{ minGames }} fois
          </div>
          <input v-model.number="minGames" type="range" min="5" max="50" step="5" class="w-full accent-brand sm:w-48" />
        </div>
        <p class="flex items-center gap-1.5 text-[11px] text-muted">
          <span class="inline-block h-2 w-px shrink-0 bg-foreground/70" />
          le trait vertical sur chaque barre marque la borne basse de Wilson (95%) -- le classement se fie à ce
          trait, pas au winrate affiché, pour ne jamais laisser un talent joué une fois passer devant un build éprouvé.
        </p>

        <div v-if="analyzerPending && !analyzerData" class="rounded-lg border border-border bg-surface p-8 text-center text-muted">
          Chargement...
        </div>

        <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div v-for="tier in TALENT_TIERS" :key="tier" class="rounded-lg border border-border bg-surface p-3">
            <h3 class="mb-2 font-heading text-sm font-medium text-muted">Palier {{ tier }}</h3>

            <div v-if="pinnedOption(tier)" class="rounded-md border border-brand/40 bg-brand/10 p-2.5">
              <p class="text-sm font-medium">{{ formatTalentName(pinnedOption(tier)!.talentName, selectedHeroName) }}</p>
              <p class="mt-1 font-mono text-xs text-muted">
                {{ formatPercent(pinnedOption(tier)!.winrate) }} win -- {{ pinnedOption(tier)!.picks }} parties (100% du palier)
              </p>
              <UButton size="2xs" color="gray" variant="soft" class="mt-2" @click="unpinTier(tier)">Déverrouiller</UButton>
            </div>

            <div v-else-if="(tierData(tier)?.options.length ?? 0) === 0" class="text-xs text-muted">Aucune donnée.</div>

            <ul v-else class="space-y-2">
              <li
                v-for="option in tierData(tier)!.options"
                :key="option.talentId"
                class="rounded-md border border-border p-2"
                :class="option.reliable ? '' : 'opacity-60'"
              >
                <div class="flex items-start justify-between gap-2">
                  <span class="text-xs font-medium leading-tight">{{ formatTalentName(option.talentName, selectedHeroName) }}</span>
                  <button
                    type="button"
                    class="shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-brand/15 hover:text-brand"
                    title="Épingler"
                    @click="togglePin(tier, option.talentId, option.talentName)"
                  >
                    <UIcon name="i-heroicons-lock-closed" class="h-3.5 w-3.5" />
                  </button>
                </div>
                <div class="relative mt-1.5 h-1.5 w-full">
                  <div class="h-full w-full overflow-hidden rounded-full bg-background">
                    <div
                      class="h-full rounded-full"
                      :class="option.winrate >= 0.5 ? 'bg-success' : 'bg-danger'"
                      :style="{ width: `${Math.round(option.winrate * 100)}%` }"
                    />
                  </div>
                  <UTooltip
                    :text="`Borne basse de Wilson (95%) : ${formatPercent(option.wilsonLowerBound)} -- winrate garanti au-delà de ce trait avec ${option.picks} parties observées`"
                    :popper="{ placement: 'top' }"
                  >
                    <span
                      class="absolute -top-0.5 h-2 w-px -translate-x-1/2 bg-foreground/70"
                      :style="{ left: `${Math.min(100, Math.max(0, Math.round(option.wilsonLowerBound * 100)))}%` }"
                    />
                  </UTooltip>
                </div>
                <div class="mt-1 flex items-center justify-between font-mono text-[11px] text-muted">
                  <span :class="option.winrate >= 0.5 ? 'text-success' : 'text-danger'">{{ formatPercent(option.winrate) }} win</span>
                  <span>{{ formatPercent(option.pickRate) }} pick · {{ option.picks }}</span>
                </div>
                <p v-if="!option.reliable" class="mt-1 flex items-center gap-1 text-[10px] text-accent">
                  <UIcon name="i-heroicons-exclamation-triangle" class="h-3 w-3" />échantillon faible
                </p>
              </li>
            </ul>
          </div>
        </div>

        <div v-if="buildRows.length > 1" class="rounded-lg border border-border bg-surface p-4">
          <h2 class="mb-1 font-heading text-sm font-medium">Carte des builds</h2>
          <p class="mb-3 text-xs text-muted">
            Les {{ Math.min(buildRows.length, 8) }} builds les mieux classés, superposés palier par palier -- suis le
            trait le plus opaque pour voir le build recommandé se détacher des variantes.
          </p>
          <ChartsBuildFlowDiagram :builds="analyzerData?.topBuilds ?? []" :hero-name="selectedHeroName" />
        </div>

        <UiPanel title="Top builds complets" :count="buildRows.length">
          <UiDataTable :columns="buildColumns" :rows="buildRows" row-key="id" clickable @row-click="(row) => applyBuild(row as (typeof buildRows.value)[number])">
            <template #cell-winrate="{ row }">
              <span :class="(row.winrate as number) >= 0.5 ? 'text-success' : 'text-danger'">
                {{ formatPercent(row.winrate as number) }}
              </span>
            </template>
          </UiDataTable>
          <p class="mt-3 text-xs text-muted">
            Triés par borne basse de Wilson (95%), pas par winrate brut -- un build gagné une fois ne passe pas devant
            un build éprouvé. Clique une ligne pour l'épingler entièrement.
          </p>
        </UiPanel>
      </template>
    </template>
  </div>
</template>
