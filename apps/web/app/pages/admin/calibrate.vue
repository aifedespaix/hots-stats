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

const minX = ref(0);
const maxX = ref(1);
const minY = ref(0);
const maxY = ref(1);
const bounds = computed(() => ({ minX: minX.value, maxX: maxX.value, minY: minY.value, maxY: maxY.value }));

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
    <p class="text-sm text-muted">
      Choisis une carte en attente de calibration, ajuste les bornes jusqu'à ce que les points se superposent
      correctement à la carte, puis sauvegarde.
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
    </section>

    <div v-if="selectedMapId" class="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <AdminCalibrationCanvas :map-id="selectedMapId" :points="points" :bounds="bounds" />

      <section class="space-y-4 rounded-lg border border-border p-4 sm:p-6">
        <h2 class="font-heading text-lg">Bornes du monde</h2>

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
