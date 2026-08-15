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
 *
 * Module-scope singleton: the nav layout and the draft page both need this
 * state (nav for the "new draft" chip/toast, the page to render it), and
 * opening one `EventSource` per caller would multiply server connections
 * for no benefit. Every call site shares the same refs and the same
 * underlying connection, opened once for the lifetime of the tab.
 */
const snapshot = ref<DraftSnapshot | null>(null);
const connected = ref(false);
let source: EventSource | null = null;
let refCount = 0;

function handleSnapshot(event: MessageEvent<string>) {
  snapshot.value = event.data ? (JSON.parse(event.data) as DraftSnapshot | null) : null;
}

function connect() {
  if (source) return;
  const config = useRuntimeConfig();
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

/** True once a snapshot has arrived and at least one slot has a name in it -- an empty draft (all slots blank) shouldn't count as "detected". */
export function isDraftSnapshotEmpty(snap: DraftSnapshot | null): boolean {
  if (!snap) return true;
  return ![...snap.teamLeft, ...snap.teamRight].some((slot) => slot.rawName);
}

export function useDraftStream() {
  onMounted(() => {
    refCount += 1;
    connect();
  });
  onUnmounted(() => {
    refCount -= 1;
    if (refCount <= 0) disconnect();
  });

  return { snapshot, connected };
}
