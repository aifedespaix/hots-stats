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
  layer: string;
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

function layerLabel(layer: string): string {
  return layer ? layer : "(défaut)";
}
function optionKey(mapId: string, layer: string): string {
  return `${mapId}::${layer}`;
}

// One unified picker for every map the tool knows about, so there's a
// single always-correct "what am I looking at" state -- the previous design
// had two independent dropdowns (the real pending-map list, and a separate
// one for picking which map to generate an example for), where choosing a
// map in the second one didn't touch what the canvas showed until you
// clicked "Générer", which looked exactly like selection silently failing.
interface MapOption {
  label: string;
  value: string; // optionKey(mapId, layer)
  mapId: string;
  layer: string;
  status: "pending" | "calibrated" | "new-layer";
}
const mapOptions = computed<MapOption[]>(() => [
  ...(pendingMaps.value?.maps ?? []).map((m) => ({
    label: `${m.mapName} — à calibrer (${m.pointCount} points)`,
    value: optionKey(m.mapId, ""),
    mapId: m.mapId,
    layer: "",
    status: "pending" as const,
  })),
  ...(calibratedMaps.value?.maps ?? []).map((m) => ({
    label: `${m.mapName} — ${layerLabel(m.layer)} (déjà calibrée)`,
    value: optionKey(m.mapId, m.layer),
    mapId: m.mapId,
    layer: m.layer,
    status: "calibrated" as const,
  })),
]);

const selectedOptionKey = ref<string | undefined>(undefined);
const selectedOption = computed(() => mapOptions.value.find((m) => m.value === selectedOptionKey.value) ?? null);
const selectedMapId = computed(() => selectedOption.value?.mapId);
const points = ref<{ x: number; y: number }[]>([]);
const loadingSample = ref(false);

const minX = ref(0);
const maxX = ref(1);
const minY = ref(0);
const maxY = ref(1);
const layer = ref("");
const bounds = computed(() => ({ minX: minX.value, maxX: maxX.value, minY: minY.value, maxY: maxY.value }));

// Every distinct mapId already offered by either list -- lets "Ajouter un
// niveau" target any map that has at least a pending sample or one
// calibrated layer, not just already-multi-level ones.
const knownMapIds = computed<{ id: string; name: string }[]>(() => {
  const byId = new Map<string, string>();
  for (const m of pendingMaps.value?.maps ?? []) byId.set(m.mapId, m.mapName);
  for (const m of calibratedMaps.value?.maps ?? []) byId.set(m.mapId, m.mapName);
  return [...byId.entries()].map(([id, name]) => ({ id, name }));
});
const newLayerMapId = ref<string | undefined>(undefined);
const newLayerKey = ref("");

async function loadSampleFor(mapId: string) {
  loadingSample.value = true;
  try {
    const sample = await $fetch<{ mapId: string; points: { x: number; y: number }[] }>(
      `/admin/spatial/samples/${mapId}`,
      { baseURL: config.public.apiBase, credentials: "include" },
    );
    points.value = sample.points;
  } catch (err) {
    if (!(err as { statusCode?: number })?.statusCode || (err as { statusCode?: number }).statusCode !== 404) {
      toast.add({ title: "Impossible de charger l'échantillon", color: "error" });
    }
  } finally {
    loadingSample.value = false;
  }
}

watch(selectedOptionKey, async (key) => {
  points.value = [];
  minX.value = 0;
  maxX.value = 1;
  minY.value = 0;
  maxY.value = 1;
  layer.value = "";
  if (!key) return;
  const option = mapOptions.value.find((m) => m.value === key);
  if (!option) return;
  layer.value = option.layer;

  // Editing an already-calibrated map starts from its saved bounds, not
  // 0..1 -- "Auto-ajuster aux points" is still there to reset from scratch
  // if the existing calibration turns out to be badly wrong.
  if (option.status === "calibrated") {
    const existing = calibratedMaps.value?.maps.find((m) => m.mapId === option.mapId && m.layer === option.layer);
    if (existing) {
      minX.value = existing.bounds.minX;
      maxX.value = existing.bounds.maxX;
      minY.value = existing.bounds.minY;
      maxY.value = existing.bounds.maxY;
    }
  }

  await loadSampleFor(option.mapId);
});

/** Starts calibrating a brand new layer (not yet saved) for `mapId`, reusing
 * that map's existing raw sample cloud -- the same undifferentiated points
 * shown for any other layer of this map, since an admin carves each level's
 * rectangle out by eye. */
async function addLayer() {
  if (!newLayerMapId.value || !newLayerKey.value.trim()) return;
  const mapId = newLayerMapId.value;
  const layerKey = newLayerKey.value.trim();
  selectedOptionKey.value = undefined;
  layer.value = layerKey;
  minX.value = 0;
  maxX.value = 1;
  minY.value = 0;
  maxY.value = 1;
  await loadSampleFor(mapId);
  // Not present in mapOptions (unsaved) -- track it as pseudo-selection via
  // a synthetic option key so the canvas/save button still have a mapId to
  // work against.
  pendingNewLayer.value = { mapId, layer: layerKey };
  newLayerKey.value = "";
}

const pendingNewLayer = ref<{ mapId: string; layer: string } | null>(null);
const activeMapId = computed(() => pendingNewLayer.value?.mapId ?? selectedMapId.value);
const activeLayer = computed(() => (pendingNewLayer.value ? pendingNewLayer.value.layer : layer.value));

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
    // entry in the list. Example generation always targets the default
    // layer ("").
    selectedOptionKey.value = optionKey(exampleMapId.value, "");
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
    body: { mapId: activeMapId.value, layer: activeLayer.value, ...bounds.value },
  });
});
const saving = calibrationField.loading;
const saveError = calibrationField.error;

async function save() {
  if (!activeMapId.value) return;
  await calibrationField.submit(undefined);
  if (saveError.value) return;
  toast.add({ title: "Carte calibrée", color: "success" });
  const savedMapId = activeMapId.value;
  const savedLayer = activeLayer.value;
  pendingNewLayer.value = null;
  selectedOptionKey.value = undefined;
  points.value = [];
  await refreshMapLists();
  selectedOptionKey.value = optionKey(savedMapId, savedLayer);
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="font-heading text-2xl font-semibold">Calibration spatiale</h1>
    <p class="max-w-2xl text-sm text-muted">
      Choisis une carte ci-dessous -- en attente de calibration (données réelles envoyées par des daemons) ou déjà
      calibrée (pour corriger une erreur) -- clique "Auto-ajuster aux points" pour partir d'une estimation
      raisonnable, affine les 4 bornes jusqu'à ce que les points rouges se superposent correctement à la carte, puis
      sauvegarde. Répète pour chaque carte listée.
    </p>

    <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
      <h2 class="font-heading text-lg">Carte</h2>
      <USelectMenu v-model="selectedOptionKey" value-key="value" :items="mapOptions" placeholder="Choisir une carte…" />
      <p v-if="mapOptions.length === 0" class="text-sm text-muted">
        Aucune carte en attente ni calibrée pour l'instant. Une carte apparaît ici une fois qu'un daemon a envoyé de
        vraies positions de joueurs pour elle (parties déjà jouées et uploadées) -- rien à faire de plus que
        d'attendre, ou de tester l'outil ci-dessous en attendant.
      </p>
    </section>

    <details class="rounded-lg border border-dashed border-border p-4 text-sm sm:p-6">
      <summary class="cursor-pointer font-heading text-sm text-muted">
        Tester l'outil avec des données factices (sans rapport avec une vraie carte)
      </summary>
      <div class="mt-3 space-y-3">
        <p class="text-xs text-muted">
          Génère un échantillon <strong>entièrement inventé</strong> (positions aléatoires) pour vérifier que l'outil
          lui-même fonctionne -- affichage, projection, sauvegarde. Ça ne sert qu'à ça : ces points ne doivent
          <strong>jamais</strong> servir à calibrer une carte en production, quel que soit leur agencement à l'écran
          une fois affichés. Le générer pour une carte déjà calibrée est sans risque : ça ne fait que rafraîchir ses
          points d'exemple, la calibration existante n'est pas modifiée tant que tu ne cliques pas "Sauvegarder".
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
    </details>

    <details class="rounded-lg border border-dashed border-border p-4 text-sm sm:p-6">
      <summary class="cursor-pointer font-heading text-sm text-muted">Ajouter un niveau à une carte existante</summary>
      <div class="mt-3 space-y-3">
        <p class="text-xs text-muted">
          Pour une carte multi-niveaux (ex. Mines Hantées : surface + sous-sol), calibre chaque niveau séparément à
          partir du même nuage de points brut. Le nom du niveau détermine l'image de fond utilisée --
          <code>haunted-mines</code> + niveau <code>bottom</code> affiche <code>haunted-mines-bottom.jpg</code>.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <USelectMenu
            v-model="newLayerMapId"
            :items="knownMapIds.map((m) => ({ label: m.name, value: m.id }))"
            value-key="value"
            size="sm"
            class="w-56"
            placeholder="Carte…"
          />
          <UInput v-model="newLayerKey" size="sm" placeholder="Nom du niveau (ex. bottom)" class="w-56" />
          <UButton size="sm" variant="soft" color="neutral" @click="addLayer">Démarrer la calibration</UButton>
        </div>
      </div>
    </details>

    <div v-if="activeMapId" class="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <div class="space-y-2">
        <AdminCalibrationCanvas :map-id="activeMapId" :layer="activeLayer || null" :points="points" :bounds="bounds" />
        <p class="text-xs text-muted">{{ points.length }} point(s) chargé(s) — niveau « {{ activeLayer || "(défaut)" }} »</p>
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
