<script setup lang="ts">
definePageMeta({ middleware: "admin" });

useSeoMeta({ title: "Calibration spatiale", robots: "noindex, nofollow" });

const config = useRuntimeConfig();
const toast = useToast();

interface PendingMapEntry {
  mapId: string;
  mapName: string;
  pointCount: number;
}
interface CalibratedMapEntry {
  mapId: string;
  mapName: string;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  updatedAt: string;
}

const { data: pendingMaps, refresh: refreshPendingMaps } = await useApiFetch<{ maps: PendingMapEntry[] }>(
  "/admin/spatial/pending-maps",
  { withGameMode: false },
);
const { data: calibratedMaps, refresh: refreshCalibratedMaps } = await useApiFetch<{ maps: CalibratedMapEntry[] }>(
  "/admin/spatial/calibrated-maps",
  { withGameMode: false },
);

async function refreshMapLists() {
  await Promise.all([refreshPendingMaps(), refreshCalibratedMaps()]);
}

// One unified picker for every map the tool knows about, so there's a
// single always-correct "what am I looking at" state -- the previous design
// had two independent dropdowns (the real pending-map list, and a separate
// one for picking which map to generate an example for), where choosing a
// map in the second one didn't touch what the canvas showed until you
// clicked "Générer", which looked exactly like selection silently failing.
interface MapOption {
  label: string;
  value: string;
  status: "pending" | "calibrated";
}
const mapOptions = computed<MapOption[]>(() => [
  ...(pendingMaps.value?.maps ?? []).map((m) => ({
    label: `${m.mapName} — à calibrer (${m.pointCount} points)`,
    value: m.mapId,
    status: "pending" as const,
  })),
  ...(calibratedMaps.value?.maps ?? []).map((m) => ({
    label: `${m.mapName} — déjà calibrée`,
    value: m.mapId,
    status: "calibrated" as const,
  })),
]);

const selectedMapId = ref<string | undefined>(undefined);
const selectedOption = computed(() => mapOptions.value.find((m) => m.value === selectedMapId.value) ?? null);
const points = ref<{ x: number; y: number; kind?: "spawn" }[]>([]);
const hasSpawnLandmark = computed(() => points.value.some((p) => p.kind === "spawn"));
const loadingSample = ref(false);

const minX = ref(0);
const maxX = ref(1);
const minY = ref(0);
const maxY = ref(1);
const bounds = computed(() => ({ minX: minX.value, maxX: maxX.value, minY: minY.value, maxY: maxY.value }));

watch(selectedMapId, async (mapId) => {
  points.value = [];
  minX.value = 0;
  maxX.value = 1;
  minY.value = 0;
  maxY.value = 1;
  if (!mapId) return;

  // Editing an already-calibrated map starts from its saved bounds, not
  // 0..1 -- "Auto-ajuster aux points" is still there to reset from scratch
  // if the existing calibration turns out to be badly wrong.
  const existing = calibratedMaps.value?.maps.find((m) => m.mapId === mapId);
  if (existing) {
    minX.value = existing.bounds.minX;
    maxX.value = existing.bounds.maxX;
    minY.value = existing.bounds.minY;
    maxY.value = existing.bounds.maxY;
  }

  loadingSample.value = true;
  try {
    const sample = await $fetch<{ mapId: string; points: { x: number; y: number; kind?: "spawn" }[] }>(
      `/admin/spatial/samples/${mapId}`,
      { baseURL: config.public.apiBase, credentials: "include" },
    );
    points.value = sample.points;
  } catch (err) {
    // An already-calibrated map calibrated before this tool started keeping
    // samples past calibration (or whose sample was never re-uploaded
    // since) legitimately has none -- not a failure, just an empty canvas
    // to eyeball the existing bounds against blind.
    if (!(existing && (err as { statusCode?: number })?.statusCode === 404)) {
      toast.add({ title: "Impossible de charger l'échantillon", color: "error" });
    }
  } finally {
    loadingSample.value = false;
  }
});

// Every map slug confirmed to have a real image at
// /images/maps/original/<slug>.jpg -- lets the example generator offer any
// real HotS map for testing, not an arbitrary subset. Purely a testing
// convenience; see generateExampleSample() in
// apps/api/src/services/spatial-calibration.service.ts.
const EXAMPLE_MAP_IDS = [
  "alterac-pass",
  "battlefield-of-eternity",
  "blackheart-s-bay",
  "braxis-holdout",
  "braxis-outpost",
  "cursed-hollow",
  "dragon-shire",
  "garden-of-terror",
  "hanamura-temple",
  "haunted-mines",
  "haunted-mines-bottom",
  "industrial-district",
  "infernal-shrines",
  "lost-cavern",
  "silver-city",
  "sky-temple",
  "tomb-of-the-spider-queen",
  "towers-of-doom",
  "volskaya-foundry",
  "warhead-junction",
];
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
    await refreshMapLists();
    // Now the one true selector -- picking it here is what actually loads
    // the fresh points into the canvas below, same as picking any other
    // entry in the list.
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
  await refreshMapLists();
  selectedMapId.value = calibratedMapId;
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="font-heading text-2xl font-semibold">Calibration spatiale</h1>
    <p class="max-w-2xl text-sm text-muted">
      Choisis une carte ci-dessous -- en attente de calibration, déjà calibrée (pour corriger une erreur), ou génère
      un exemple si aucune vraie donnée n'est encore disponible -- clique "Auto-ajuster aux points" pour partir d'une
      estimation raisonnable, affine les 4 bornes jusqu'à ce que les points rouges se superposent correctement à la
      carte, puis sauvegarde.
    </p>

    <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
      <h2 class="font-heading text-lg">Carte</h2>
      <USelectMenu v-model="selectedMapId" value-key="value" :items="mapOptions" placeholder="Choisir une carte…" />
      <p v-if="mapOptions.length === 0" class="text-sm text-muted">
        Aucune carte en attente ni calibrée pour l'instant -- génère un exemple ci-dessous pour tester l'outil.
      </p>

      <div class="rounded-md border border-dashed border-border p-3">
        <p class="mb-2 text-xs text-muted">
          Pas de vraie donnée sous la main ? Génère un échantillon synthétique pour tester l'outil de bout en bout
          (les points n'ont aucun rapport avec la vraie géométrie de la carte — ne calibre jamais une carte en
          production à partir d'un exemple). Le générer pour une carte déjà calibrée est sans risque : ça ne fait
          que rafraîchir ses points d'exemple, la calibration existante n'est pas modifiée tant que tu ne cliques pas
          "Sauvegarder".
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
        <p v-if="hasSpawnLandmark" class="flex items-center gap-1.5 text-xs text-muted">
          <span class="inline-block h-2.5 w-2.5 rounded-full" style="background: rgba(234, 179, 8, 0.9)" />
          Points dorés = zone de spawn de l'exemple (plusieurs héros groupés) -- un repère utile pour caler
          précisément la calibration, y compris sur une vraie donnée.
        </p>
      </div>

      <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
        <h2 class="font-heading text-lg">
          Bornes du monde
          <UBadge v-if="selectedOption?.status === 'calibrated'" color="neutral" variant="subtle" size="sm">
            Modification
          </UBadge>
        </h2>
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
