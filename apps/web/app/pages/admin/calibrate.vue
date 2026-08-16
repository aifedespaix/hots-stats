<script setup lang="ts">
definePageMeta({ middleware: "admin" });

useSeoMeta({ title: "Calibration spatiale", robots: "noindex, nofollow" });

const config = useRuntimeConfig();
const toast = useToast();

const { data: pendingMaps, refresh: refreshPendingMaps } = await useApiFetch<{ mapIds: string[] }>(
  "/admin/spatial/pending-maps",
  { withGameMode: false },
);
const mapItems = computed(() => (pendingMaps.value?.mapIds ?? []).map((id) => ({ label: id, value: id })));

const selectedMapId = ref<string | undefined>(undefined);
const points = ref<{ x: number; y: number }[]>([]);
const loadingSample = ref(false);

watch(selectedMapId, async (mapId) => {
  points.value = [];
  if (!mapId) return;
  loadingSample.value = true;
  try {
    const sample = await $fetch<{ mapId: string; points: { x: number; y: number }[] }>(
      `/admin/spatial/samples/${mapId}`,
      { baseURL: config.public.apiBase, credentials: "include" },
    );
    points.value = sample.points;
  } catch {
    toast.add({ title: "Impossible de charger l'échantillon", color: "error" });
  } finally {
    loadingSample.value = false;
  }
});

// Curated slugs confirmed to have a real image at
// /images/maps/original/<slug>.jpg -- purely a testing convenience so an
// admin can exercise this tool without a real daemon replay upload. See
// generateExampleSample() in apps/api/src/services/spatial-calibration.service.ts.
const EXAMPLE_MAP_IDS = ["dragon-shire", "cursed-hollow", "battlefield-of-eternity", "sky-temple", "towers-of-doom"];
const exampleMapId = ref(EXAMPLE_MAP_IDS[0]!);
const generatingExample = ref(false);

async function generateExample() {
  generatingExample.value = true;
  try {
    await $fetch(`/admin/spatial/samples/${exampleMapId.value}/example`, {
      method: "POST",
      baseURL: config.public.apiBase,
      credentials: "include",
    });
    await refreshPendingMaps();
    selectedMapId.value = exampleMapId.value;
    toast.add({
      title: "Exemple généré",
      description: "Clique \"Auto-ajuster aux points\" pour voir le résultat, ou ajuste les bornes à la main.",
      color: "success",
    });
  } catch {
    toast.add({ title: "Impossible de générer l'exemple", color: "error" });
  } finally {
    generatingExample.value = false;
  }
}

const minX = ref(0);
const maxX = ref(1);
const minY = ref(0);
const maxY = ref(1);
const bounds = computed(() => ({ minX: minX.value, maxX: maxX.value, minY: minY.value, maxY: maxY.value }));

// Fraction of the raw points' own bounding-box span added as margin on
// each side, so points don't sit flush against the canvas edge.
const AUTO_FIT_PADDING_RATIO = 0.1;

function autoFitBounds() {
  if (points.value.length === 0) return;
  const xs = points.value.map((p) => p.x);
  const ys = points.value.map((p) => p.y);
  const rawMinX = Math.min(...xs);
  const rawMaxX = Math.max(...xs);
  const rawMinY = Math.min(...ys);
  const rawMaxY = Math.max(...ys);
  const padX = Math.max((rawMaxX - rawMinX) * AUTO_FIT_PADDING_RATIO, 1);
  const padY = Math.max((rawMaxY - rawMinY) * AUTO_FIT_PADDING_RATIO, 1);
  minX.value = Math.round((rawMinX - padX) * 100) / 100;
  maxX.value = Math.round((rawMaxX + padX) * 100) / 100;
  minY.value = Math.round((rawMinY - padY) * 100) / 100;
  maxY.value = Math.round((rawMaxY + padY) * 100) / 100;
}

const calibrationField = useSavableField(async () => {
  await $fetch("/admin/spatial/calibrate", {
    method: "POST",
    baseURL: config.public.apiBase,
    credentials: "include",
    body: { mapId: selectedMapId.value, ...bounds.value },
  });
});
const saving = calibrationField.loading;
const saveError = calibrationField.error;

async function save() {
  if (!selectedMapId.value) return;
  await calibrationField.submit(undefined);
  if (saveError.value) return;
  toast.add({ title: "Carte calibrée", color: "success" });
  const calibratedMapId = selectedMapId.value;
  selectedMapId.value = undefined;
  points.value = [];
  await refreshPendingMaps();
  if (pendingMaps.value?.mapIds.includes(calibratedMapId)) {
    // Defensive: the API deletes the pending sample on a successful
    // calibration, so this shouldn't happen -- but never leave a
    // just-calibrated map looking selectable again if it somehow does.
    pendingMaps.value.mapIds = pendingMaps.value.mapIds.filter((id) => id !== calibratedMapId);
  }
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="font-heading text-2xl font-semibold">Calibration spatiale</h1>
    <p class="max-w-2xl text-sm text-muted">
      Choisis une carte en attente de calibration (ou génère un exemple ci-dessous pour tester l'outil), clique
      "Auto-ajuster aux points" pour partir d'une estimation raisonnable, affine les 4 bornes jusqu'à ce que les
      points rouges se superposent correctement à la carte, puis sauvegarde.
    </p>

    <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
      <h2 class="font-heading text-lg">Carte</h2>
      <USelectMenu
        v-model="selectedMapId"
        value-key="value"
        :items="mapItems"
        placeholder="Choisir une carte en attente…"
      />
      <p v-if="mapItems.length === 0" class="text-sm text-muted">Aucune carte en attente de calibration.</p>

      <div class="rounded-md border border-dashed border-border p-3">
        <p class="mb-2 text-xs text-muted">
          Pas de vraie donnée sous la main ? Génère un échantillon synthétique pour tester l'outil de bout en bout
          (les points n'ont aucun rapport avec la vraie géométrie de la carte — ne calibre jamais une carte en
          production à partir d'un exemple).
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <USelectMenu
            v-model="exampleMapId"
            :items="EXAMPLE_MAP_IDS.map((id) => ({ label: id, value: id }))"
            value-key="value"
            size="sm"
            class="w-56"
          />
          <UButton
            size="sm"
            variant="soft"
            color="neutral"
            icon="i-heroicons-beaker"
            :loading="generatingExample"
            @click="generateExample"
          >
            Générer un exemple pour cette carte
          </UButton>
        </div>
      </div>
    </section>

    <div v-if="selectedMapId" class="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <div class="space-y-2">
        <AdminCalibrationCanvas :map-id="selectedMapId" :points="points" :bounds="bounds" />
        <p class="text-xs text-muted">{{ points.length }} point(s) chargé(s)</p>
      </div>

      <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
        <h2 class="font-heading text-lg">Bornes du monde</h2>
        <p class="text-xs text-muted">
          Coordonnées brutes du jeu (pas des pixels) délimitant la zone jouable. Elles doivent englober tous les
          points affichés sans être beaucoup plus grandes que nécessaire.
        </p>

        <UButton size="sm" variant="soft" color="neutral" icon="i-heroicons-viewfinder-circle" block @click="autoFitBounds">
          Auto-ajuster aux points
        </UButton>

        <div class="space-y-2">
          <label class="text-xs text-muted">Min X</label>
          <UInput v-model.number="minX" type="number" step="any" />
        </div>
        <div class="space-y-2">
          <label class="text-xs text-muted">Max X</label>
          <UInput v-model.number="maxX" type="number" step="any" />
        </div>
        <div class="space-y-2">
          <label class="text-xs text-muted">Min Y</label>
          <UInput v-model.number="minY" type="number" step="any" />
        </div>
        <div class="space-y-2">
          <label class="text-xs text-muted">Max Y</label>
          <UInput v-model.number="maxY" type="number" step="any" />
        </div>

        <UButton :loading="saving" icon="i-heroicons-check" block @click="save">Sauvegarder la calibration</UButton>
        <p v-if="saveError" class="text-sm text-danger">{{ saveError }}</p>
        <p v-if="loadingSample" class="text-sm text-muted">Chargement de l'échantillon…</p>
      </section>
    </div>
  </div>
</template>
