import type { DraftSnapshot } from "@hots-stats/shared-types";
import { draftPollRetryDelayMs, shouldReplaceDraftSnapshot } from "~/utils/draftPoll";

// The live-draft push is a long-poll, not a Server-Sent-Events stream: the API
// runs behind Cloudflare (see DEPLOYMENT.md), and Cloudflare's HTTP/3 (QUIC)
// edge resets long-lived streaming responses. `GET /draft/stream` therefore
// failed in Chrome with `net::ERR_QUIC_PROTOCOL_ERROR` -- the request had
// already answered 200, so `EventSource` retried forever in a loop.
// `GET /draft/poll` keeps a *short* request open server-side and answers the
// instant a snapshot is published, so the browser gets the same near-realtime
// updates over requests QUIC has no trouble with.

/**
 * Keeps a reactive `snapshot` in sync with the viewer's live draft by
 * long-polling `GET /draft/poll`. The server answers as soon as a snapshot
 * lands (or after its hold expires with nothing new -- the client just
 * re-polls), so a page opened *after* the daemon captured a draft still shows
 * it: there's no separate "fetch on mount" step needed.
 *
 * Module-scope singleton: the nav layout and the draft page both need this
 * state (nav for the "new draft" chip/toast, the page to render it), and one
 * shared loop avoids multiplying held requests. Every call site shares the
 * same refs and the same loop, started once for the lifetime of the tab.
 */
const snapshot = ref<DraftSnapshot | null>(null);
const connected = ref(false);
let apiBase = "";
let cursor: string | null = null;
let refCount = 0;
let generation = 0;
let controller: AbortController | null = null;
let stopped = true;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollLoop(gen: number) {
  let failures = 0;

  while (!stopped && gen === generation) {
    try {
      const query = cursor ? `?since=${encodeURIComponent(cursor)}` : "";
      const res = await fetch(`${apiBase}/draft/poll${query}`, {
        credentials: "include",
        headers: { accept: "application/json" },
        signal: controller?.signal,
      });
      if (!res.ok) throw new Error(`draft poll failed with ${res.status}`);

      const data = (await res.json()) as { snapshot: DraftSnapshot | null; id: string | null };
      if (stopped || gen !== generation) return;

      const previousId = cursor;
      cursor = data.id;
      if (shouldReplaceDraftSnapshot(previousId, data)) snapshot.value = data.snapshot;

      connected.value = true;
      failures = 0;
    } catch (error) {
      if (stopped || gen !== generation || (error as Error)?.name === "AbortError") return;
      connected.value = false;
      failures += 1;
      await sleep(draftPollRetryDelayMs(failures));
    }
  }
}

function connect() {
  disconnect();
  stopped = false;
  generation += 1;
  controller = new AbortController();
  void pollLoop(generation);
}

function disconnect() {
  stopped = true;
  generation += 1;
  controller?.abort();
  controller = null;
  connected.value = false;
}

/** True once a snapshot has arrived and at least one slot has a name in it -- an empty draft (all slots blank) shouldn't count as "detected". */
export function isDraftSnapshotEmpty(snap: DraftSnapshot | null): boolean {
  if (!snap) return true;
  return ![...snap.teamLeft, ...snap.teamRight].some((slot) => slot.rawName);
}

// Defense-in-depth for OS sleep / a long-backgrounded tab: a held request can
// be silently dropped while hidden or offline without the loop noticing until
// it settles, so nudge it when the tab regains focus or the network returns.
function handleFocusOrOnline() {
  if (document.visibilityState === "visible" && !connected.value) connect();
}

export function useDraftStream() {
  apiBase = useRuntimeConfig().public.apiBase as string;

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
