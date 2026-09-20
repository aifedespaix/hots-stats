/**
 * Resolves with the first value pushed through `subscribe`, or `null` when
 * `timeoutMs` elapses or `signal` aborts first. Whichever happens, the
 * subscription is torn down exactly once, and later deliveries are ignored --
 * this is the "hold" behind `GET /draft/poll`, where `subscribe` registers an
 * SSE-style sink and the route returns the pushed snapshot.
 */
export function waitForFirst<T>(
  subscribe: (deliver: (value: T) => void) => () => void,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    function finish(value: T | null) {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      unsubscribe?.();
      resolve(value);
    }

    function onAbort() {
      finish(null);
    }

    unsubscribe = subscribe((value) => finish(value));
    if (settled) {
      // The subscription delivered synchronously, before `unsubscribe` was
      // assigned -- `finish` could not tear it down, so do it here.
      unsubscribe();
      return;
    }

    timer = setTimeout(() => finish(null), timeoutMs);
    if (signal?.aborted) finish(null);
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}
