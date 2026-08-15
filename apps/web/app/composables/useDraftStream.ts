import type { DraftSnapshot } from "@hots-stats/shared-types";

// Base delay for the manual reconnect fallback below. Native EventSource
// retry already uses its own (browser-default ~3s) delay for ordinary
// network blips; this is only the backoff for the fallback path.
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * Opens the live-draft SSE connection (`GET /draft/stream`) and keeps a
 * reactive `snapshot` in sync with it. The server pushes the viewer's
 * current snapshot the moment the connection opens (see
 * apps/api/src/routes/draft.ts), so a page opened *after* the daemon
 * captured a draft still shows it -- there's no separate "fetch on mount"
 * step needed.
 *
 * `EventSource` reconnects on its own for ordinary network blips, but it
 * gives up for good (`readyState` stuck at `CLOSED`, no further retry) on a
 * "fatal" connection failure -- a non-2xx response from a transient
 * API restart/proxy hiccup, for instance -- and background tabs/OS sleep
 * can also leave a connection silently dead without a timely `error` event.
 * Both were the likely cause of "loses connection and never comes back
 * without a manual reload": this composable backs the native retry up with
 * its own backoff-based reconnect whenever the source has actually closed,
 * plus a reconnect check when the tab regains focus/network.
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
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;

function handleSnapshot(event: MessageEvent<string>) {
  snapshot.value = event.data ? (JSON.parse(event.data) as DraftSnapshot | null) : null;
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt, RECONNECT_MAX_DELAY_MS);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  clearReconnectTimer();
  source?.close();

  const config = useRuntimeConfig();
  source = new EventSource(`${config.public.apiBase}/draft/stream`, { withCredentials: true });
  source.addEventListener("open", () => {
    connected.value = true;
    reconnectAttempt = 0;
  });
  source.addEventListener("snapshot", handleSnapshot as EventListener);
  source.addEventListener("error", () => {
    connected.value = false;
    // The browser already retries on its own unless the connection has
    // fully closed (a fatal HTTP-level failure) -- that's the case native
    // auto-reconnect won't recover from, so back it up here.
    if (source?.readyState === EventSource.CLOSED) scheduleReconnect();
  });
}

function disconnect() {
  clearReconnectTimer();
  source?.close();
  source = null;
  connected.value = false;
}

// Defense-in-depth for OS sleep / a long-backgrounded tab: some browsers
// suspend or silently drop long-lived connections while hidden or
// offline without ever firing a timely `error` event, so the stream can
// be dead well before the native retry (or the check above) notices.
function handleFocusOrOnline() {
  if (document.visibilityState === "visible" && !connected.value) connect();
}

/** True once a snapshot has arrived and at least one slot has a name in it -- an empty draft (all slots blank) shouldn't count as "detected". */
export function isDraftSnapshotEmpty(snap: DraftSnapshot | null): boolean {
  if (!snap) return true;
  return ![...snap.teamLeft, ...snap.teamRight].some((slot) => slot.rawName);
}

export function useDraftStream() {
  onMounted(() => {
    refCount += 1;
    if (refCount === 1) {
      connect();
      document.addEventListener("visibilitychange", handleFocusOrOnline);
      window.addEventListener("online", handleFocusOrOnline);
    }
  });
  onUnmounted(() => {
    refCount -= 1;
    if (refCount <= 0) {
      disconnect();
      document.removeEventListener("visibilitychange", handleFocusOrOnline);
      window.removeEventListener("online", handleFocusOrOnline);
    }
  });

  return { snapshot, connected };
}
