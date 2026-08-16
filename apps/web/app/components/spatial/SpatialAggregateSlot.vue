<script setup lang="ts">
import type { SpatialAggregateResponse } from "~/types/spatial";
import { gridFromWireArrays } from "@hots-stats/shared-types";

const HERO_ROLES = ["Tank", "Bruiser", "RangedAssassin", "MeleeAssassin", "Healer", "Support"] as const;
const ROLE_LABELS: Record<(typeof HERO_ROLES)[number], string> = {
  Tank: "Tanks",
  Bruiser: "Bruisers",
  RangedAssassin: "Assassins à distance",
  MeleeAssassin: "Assassins de mêlée",
  Healer: "Soigneurs",
  Support: "Supports",
};

const props = defineProps<{
  mapId: string;
  heroOptions: { id: string; name: string }[];
  /** When set, defaults the Slot to "moi" instead of "tous les joueurs". */
  myBattletag?: string | null;
}>();

const config = useRuntimeConfig();

type PlayerMode = "global" | "me" | "other";
const playerMode = ref<PlayerMode>("global");
const otherBattletag = ref("");
type HeroSelector = "hero" | "role";
const heroSelector = ref<HeroSelector>("hero");
const selectedHeroId = ref<string | undefined>(props.heroOptions[0]?.id);
const selectedRole = ref<(typeof HERO_ROLES)[number]>("Tank");
const outcome = ref<"all" | "win" | "loss">("all");

const battletag = computed(() => {
  if (playerMode.value === "me") return props.myBattletag ?? null;
  if (playerMode.value === "other") return otherBattletag.value.trim() || null;
  return null;
});
const isGlobal = computed(() => playerMode.value === "global");

const data = ref<SpatialAggregateResponse | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);

async function load() {
  const heroParam = heroSelector.value === "hero" ? selectedHeroId.value : undefined;
  const roleParam = heroSelector.value === "role" ? selectedRole.value : undefined;
  if (!heroParam && !roleParam) return;
  if (!isGlobal.value && !battletag.value) return;

  loading.value = true;
  loadError.value = null;
  try {
    data.value = await $fetch<SpatialAggregateResponse>("/spatial/aggregate", {
      baseURL: config.public.apiBase,
      credentials: "include",
      query: {
        mapId: props.mapId,
        ...(heroParam ? { heroId: heroParam } : { role: roleParam }),
        ...(isGlobal.value ? { global: "true" } : { battletag: battletag.value }),
        outcome: outcome.value,
      },
    });
  } catch (err) {
    loadError.value = (err as { data?: { error?: unknown } })?.data?.error ? "Requête invalide" : "Impossible de charger l'agrégat";
    data.value = null;
  } finally {
    loading.value = false;
  }
}

watch([playerMode, otherBattletag, heroSelector, selectedHeroId, selectedRole, outcome], load, { immediate: true });

const presenceGrid = computed(() => (data.value ? gridFromWireArrays(data.value.presence.cellIndex, data.value.presence.values) : {}));
const killsGrid = computed(() => (data.value ? gridFromWireArrays(data.value.kills.cellIndex, data.value.kills.values) : {}));
const deathsGrid = computed(() => (data.value ? gridFromWireArrays(data.value.deaths.cellIndex, data.value.deaths.values) : {}));
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end gap-3">
      <div class="space-y-1">
        <label class="text-xs text-muted">Portée</label>
        <div class="flex gap-1">
          <UButton size="xs" :variant="playerMode === 'global' ? 'solid' : 'soft'" color="neutral" @click="playerMode = 'global'">
            Moyenne globale
          </UButton>
          <UButton
            v-if="myBattletag"
            size="xs"
            :variant="playerMode === 'me' ? 'solid' : 'soft'"
            color="neutral"
            @click="playerMode = 'me'"
          >
            Moi
          </UButton>
          <UButton size="xs" :variant="playerMode === 'other' ? 'solid' : 'soft'" color="neutral" @click="playerMode = 'other'">
            Un joueur…
          </UButton>
        </div>
      </div>

      <UInput
        v-if="playerMode === 'other'"
        v-model="otherBattletag"
        placeholder="Pseudo#12345"
        size="sm"
        class="w-40 font-mono"
      />

      <div class="space-y-1">
        <label class="text-xs text-muted">Héros / rôle</label>
        <div class="flex gap-1">
          <USelectMenu
            v-if="heroSelector === 'hero'"
            v-model="selectedHeroId"
            value-key="id"
            label-key="name"
            :items="heroOptions"
            size="sm"
            class="w-40"
          />
          <USelectMenu
            v-else
            v-model="selectedRole"
            value-key="value"
            label-key="label"
            :items="HERO_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))"
            size="sm"
            class="w-40"
          />
          <UButton
            size="xs"
            variant="soft"
            color="neutral"
            :icon="heroSelector === 'hero' ? 'i-heroicons-user-group' : 'i-heroicons-user'"
            @click="heroSelector = heroSelector === 'hero' ? 'role' : 'hero'"
          >
            {{ heroSelector === "hero" ? "Par rôle" : "Par héros" }}
          </UButton>
        </div>
      </div>

      <div class="space-y-1">
        <label class="text-xs text-muted">Issue</label>
        <USelectMenu
          v-model="outcome"
          value-key="value"
          label-key="label"
          :items="[
            { value: 'all', label: 'Toutes' },
            { value: 'win', label: 'Victoires' },
            { value: 'loss', label: 'Défaites' },
          ]"
          size="sm"
          class="w-32"
        />
      </div>
    </div>

    <p v-if="loadError" class="text-sm text-danger">{{ loadError }}</p>
    <p v-else-if="loading" class="text-sm text-muted">Chargement…</p>
    <p v-else-if="data && data.matchCount === 0" class="text-sm text-muted">
      Aucune partie enregistrée pour cette sélection.
    </p>

    <template v-if="data && data.grid && data.matchCount > 0">
      <p class="text-xs text-muted">{{ data.matchCount }} partie(s) agrégée(s)</p>
      <SpatialHeatmapView
        :map-id="mapId"
        :grid-cols="data.grid.cols"
        :grid-rows="data.grid.rows"
        :presence-grid="presenceGrid"
        :kills-grid="killsGrid"
        :deaths-grid="deathsGrid"
      />
    </template>
  </div>
</template>
