import type { DraftSnapshot } from "@hots-stats/shared-types";

/**
 * Opens the live-draft SSE connection (`GET /draft/stream`) and keeps a
 * reactive `snapshot` in sync with it. The server pushes the viewer's
 * current snapshot the moment the connection opens (see
 * apps/api/src/routes/draft.ts), so a page opened *after* the daemon
 * captured a draft still shows it -- there's no separate "fetch on mount"
 * step needed. `EventSource` reconnects on its own when the connection
 * drops (network blip, API restart); `connected` just reflects that state
 * for the UI's live indicator.
 */
export function useDraftStream() {
  const config = useRuntimeConfig();
  const snapshot = ref<DraftSnapshot | null>(null);
  const connected = ref(false);

  let source: EventSource | null = null;

  function handleSnapshot(event: MessageEvent<string>) {
    snapshot.value = event.data ? (JSON.parse(event.data) as DraftSnapshot | null) : null;
  }

  function connect() {
    source = new EventSource(`${config.public.apiBase}/draft/stream`, { withCredentials: true });
    source.addEventListener("open", () => {
      connected.value = true;
    });
    source.addEventListener("snapshot", handleSnapshot as EventListener);
    source.addEventListener("error", () => {
      connected.value = false;
    });
  }

  function disconnect() {
    source?.close();
    source = null;
    connected.value = false;
  }

  onMounted(connect);
  onUnmounted(disconnect);

  return { snapshot, connected };
}
