<script setup lang="ts">
import type { UploadItemStatus } from "~/composables/useReplayUpload";

const { queue, uploading, dragActive, addFiles, removeItem, clearFinished } = useReplayUpload();
const toast = useToast();

// dragenter/dragleave fire once per descendant element the pointer crosses,
// not once per zone -- a depth counter (rather than a plain boolean) is what
// keeps `dragActive` from flickering off while the pointer is still over a
// child element inside the dropzone.
const dragDepth = ref(0);
const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);

function onDragEnter(event: DragEvent) {
  event.preventDefault();
  dragDepth.value++;
  dragActive.value = true;
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
}

function onDragLeave(event: DragEvent) {
  event.preventDefault();
  dragDepth.value = Math.max(0, dragDepth.value - 1);
  if (dragDepth.value === 0) dragActive.value = false;
}

function handleNewFiles(files: File[]) {
  if (files.length === 0) return;
  const { added, ignored } = addFiles(files);
  if (added === 0) {
    toast.add({
      title: "Aucun replay trouvé",
      description: "Seuls les fichiers .StormReplay sont acceptés.",
      icon: "i-heroicons-exclamation-triangle",
      color: "warning",
    });
  } else if (ignored > 0) {
    toast.add({
      title: `${added} replay${added > 1 ? "s" : ""} ajouté${added > 1 ? "s" : ""}`,
      description: `${ignored} autre${ignored > 1 ? "s" : ""} fichier${ignored > 1 ? "s" : ""} ignoré${ignored > 1 ? "s" : ""} (pas un .StormReplay).`,
      icon: "i-heroicons-information-circle",
      color: "info",
    });
  }
}

async function onDrop(event: DragEvent) {
  event.preventDefault();
  dragDepth.value = 0;
  dragActive.value = false;
  if (!event.dataTransfer) return;
  handleNewFiles(await collectFilesFromDataTransfer(event.dataTransfer));
}

function onFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  handleNewFiles(Array.from(input.files ?? []));
  input.value = "";
}

const stats = computed(() => ({
  total: queue.value.length,
  uploaded: queue.value.filter((item) => item.status === "uploaded").length,
  errors: queue.value.filter((item) => item.status === "error").length,
  pending: queue.value.filter((item) => item.status === "queued" || item.status === "uploading").length,
}));

const STATUS_META: Record<UploadItemStatus, { icon: string; class: string; iconClass?: string; label: string }> = {
  queued: { icon: "i-heroicons-clock", class: "text-muted", label: "En attente" },
  uploading: { icon: "i-heroicons-arrow-path", class: "text-brand", iconClass: "animate-spin", label: "Envoi" },
  uploaded: { icon: "i-heroicons-check-circle", class: "text-success", label: "Envoyée" },
  skipped: { icon: "i-heroicons-check-circle", class: "text-muted", label: "Déjà envoyée" },
  quarantined: { icon: "i-heroicons-shield-exclamation", class: "text-accent", label: "Vérification en cours" },
  error: { icon: "i-heroicons-x-circle", class: "text-danger", label: "Échec" },
};
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-center gap-2">
      <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand">
        1
      </span>
      <h2 class="font-heading text-lg font-medium">Upload manuel</h2>
    </div>
    <p class="text-sm text-muted">
      Glisse tes fichiers <code class="rounded bg-background px-1 py-0.5 font-mono text-xs">.StormReplay</code>
      ici, ou un dossier entier. Aucune configuration.
    </p>

    <div
      class="relative flex min-h-64 flex-1 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-6 text-center transition-all duration-200 sm:p-8"
      :class="dragActive ? 'scale-[1.01] border-brand bg-brand/10' : 'border-border bg-surface hover:border-brand/40'"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div
        class="flex h-16 w-16 items-center justify-center rounded-full bg-brand/15 text-brand transition-transform duration-200"
        :class="dragActive ? 'scale-110' : ''"
      >
        <UIcon :name="dragActive ? 'i-heroicons-arrow-down-tray' : 'i-heroicons-cloud-arrow-up'" class="h-8 w-8" />
      </div>

      <div>
        <p class="font-heading text-base font-medium">
          {{ dragActive ? "Lâche pour envoyer" : "Glisse-dépose tes replays" }}
        </p>
        <p class="mt-1 text-xs text-muted">Fichiers .StormReplay ou dossier complet</p>
      </div>

      <div class="flex flex-wrap items-center justify-center gap-2">
        <UButton size="sm" variant="soft" icon="i-heroicons-document-plus" @click="fileInput?.click()">
          Sélectionner des fichiers
        </UButton>
        <UButton size="sm" variant="soft" icon="i-heroicons-folder-open" @click="folderInput?.click()">
          Sélectionner un dossier
        </UButton>
      </div>

      <input ref="fileInput" type="file" accept=".StormReplay" multiple class="hidden" @change="onFileInputChange">
      <input ref="folderInput" type="file" webkitdirectory multiple class="hidden" @change="onFileInputChange">
    </div>

    <div v-if="queue.length > 0" class="space-y-2 rounded-lg border border-border bg-surface p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs font-medium uppercase tracking-wide text-muted">
          {{ stats.total }} fichier{{ stats.total > 1 ? "s" : "" }}
          <span v-if="uploading || stats.pending > 0" class="text-brand">· envoi en cours</span>
          <span v-if="stats.uploaded > 0" class="text-success">· {{ stats.uploaded }} envoyée{{ stats.uploaded > 1 ? "s" : "" }}</span>
          <span v-if="stats.errors > 0" class="text-danger">· {{ stats.errors }} erreur{{ stats.errors > 1 ? "s" : "" }}</span>
        </p>
        <UButton v-if="stats.pending === 0" size="xs" variant="ghost" color="neutral" @click="clearFinished">
          Vider la liste
        </UButton>
      </div>

      <ul class="max-h-64 space-y-1 overflow-y-auto pr-1">
        <li
          v-for="item in queue"
          :key="item.id"
          class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-background/60"
        >
          <UIcon
            :name="STATUS_META[item.status].icon"
            class="h-4 w-4 shrink-0"
            :class="[STATUS_META[item.status].class, STATUS_META[item.status].iconClass]"
          />
          <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ item.file.name }}</span>
          <span class="shrink-0 text-[11px]" :class="STATUS_META[item.status].class">
            {{ item.message ?? STATUS_META[item.status].label }}
          </span>
          <button
            v-if="item.status !== 'uploading'"
            type="button"
            class="shrink-0 text-muted transition-colors hover:text-danger"
            aria-label="Retirer"
            @click="removeItem(item.id)"
          >
            <UIcon name="i-heroicons-x-mark" class="h-3.5 w-3.5" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
