const REPLAY_EXTENSION = ".stormreplay";
// Kept well under the API's own MAX_FILES_PER_REQUEST (50, see
// apps/api/src/routes/uploads.ts) so the UI updates progressively on a big
// folder drop instead of waiting on one giant request with no feedback.
const BATCH_SIZE = 10;

export type UploadItemStatus = "queued" | "uploading" | "uploaded" | "skipped" | "quarantined" | "error";

export interface UploadQueueItem {
  id: string;
  file: File;
  status: UploadItemStatus;
  message?: string;
}

interface UploadOutcome {
  fileName: string;
  status: "uploaded" | "skipped" | "quarantined" | "error";
  matchId?: string;
  reason?: string;
  message?: string;
}

function isReplayFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(REPLAY_EXTENSION);
}

function readDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function collectFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return [await fileFromEntry(entry as FileSystemFileEntry)];
  }
  if (entry.isDirectory) {
    // `readEntries` is paginated (browsers cap each call, commonly at 100)
    // -- it must be called repeatedly until it returns an empty array, not
    // just once, or a folder with many replays silently loses the tail.
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const files: File[] = [];
    let batch = await readDirectoryEntries(reader);
    while (batch.length > 0) {
      for (const child of batch) {
        files.push(...(await collectFilesFromEntry(child)));
      }
      batch = await readDirectoryEntries(reader);
    }
    return files;
  }
  return [];
}

/**
 * Resolves whatever was dropped -- loose files, or a whole folder -- into a
 * flat file list. `DataTransfer.files` alone is flat and silently drops
 * nested files when a directory is dropped, so a folder drop must instead
 * walk `webkitGetAsEntry()` recursively; that API is available in every
 * evergreen browser (Chrome, Edge, Firefox, Safari) despite the
 * vendor-prefixed name.
 */
export async function collectFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items);
  const hasEntrySupport = items.length > 0 && typeof items[0]?.webkitGetAsEntry === "function";
  if (!hasEntrySupport) {
    return Array.from(dataTransfer.files);
  }

  const entries = items
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  const results = await Promise.all(entries.map((entry) => collectFilesFromEntry(entry)));
  return results.flat();
}

/**
 * Drives the whole manual-upload flow on `/upload`'s left column: takes
 * whatever files/folders the user dropped or picked, filters to
 * `.StormReplay`, uploads them in small batches to `POST /uploads`
 * (apps/api), and tracks a per-file status the Dropzone renders as a live
 * queue. Web upload and the daemon are deliberately kept as two independent
 * paths into the same pipeline -- see apps/api/src/services/
 * replay-ingest.service.ts, shared by both.
 */
export function useReplayUpload() {
  const config = useRuntimeConfig();
  const queue = ref<UploadQueueItem[]>([]);
  const uploading = ref(false);
  const dragActive = ref(false);

  function addFiles(files: File[]): { added: number; ignored: number } {
    const replays = files.filter(isReplayFile);
    const items: UploadQueueItem[] = replays.map((file) => ({
      id: `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2, 8)}`,
      file,
      status: "queued",
    }));
    queue.value.push(...items);
    void startUpload();
    return { added: items.length, ignored: files.length - replays.length };
  }

  async function uploadBatch(items: UploadQueueItem[]) {
    const form = new FormData();
    for (const item of items) {
      form.append("files", item.file, item.file.name);
      item.status = "uploading";
    }

    try {
      const res = await $fetch<{ results: UploadOutcome[] }>("/uploads", {
        method: "POST",
        baseURL: config.public.apiBase,
        credentials: "include",
        body: form,
      });
      // The API processes (and returns) `files` in the exact order it
      // received them, so positional matching is safe and -- unlike
      // matching by file name -- correct even when two dropped files share
      // a name (plausible: HotS replay filenames are date/time-based).
      res.results.forEach((result, index) => {
        const item = items[index];
        if (!item) return;
        item.status = result.status;
        item.message = result.message ?? (result.status === "skipped" ? "Déjà envoyée" : undefined);
      });
    } catch (err) {
      const detail = (err as { data?: { error?: string } })?.data?.error;
      for (const item of items) {
        item.status = "error";
        item.message = detail ?? "Échec de l'envoi";
      }
    }
  }

  async function startUpload() {
    if (uploading.value) return;
    uploading.value = true;
    try {
      // Re-read `queue.value` on every loop iteration (not a snapshot taken
      // once) so files added mid-upload (dropped while a previous batch is
      // still in flight) get picked up by this same run.
      let pending = queue.value.filter((item) => item.status === "queued");
      while (pending.length > 0) {
        await uploadBatch(pending.slice(0, BATCH_SIZE));
        pending = queue.value.filter((item) => item.status === "queued");
      }
    } finally {
      uploading.value = false;
    }
  }

  function removeItem(id: string) {
    queue.value = queue.value.filter((item) => item.id !== id);
  }

  function clearFinished() {
    queue.value = queue.value.filter((item) => item.status === "queued" || item.status === "uploading");
  }

  return { queue, uploading, dragActive, addFiles, removeItem, clearFinished };
}
