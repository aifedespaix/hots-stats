/**
 * Minimal per-process fixed-window rate limiter. Deliberately in-memory and
 * approximate behind multiple API instances -- the real backstop for the
 * daemon auth endpoints is the 60-second single-use authorization code.
 */
export interface FixedWindowLimiter {
  /** @param now injectable so tests do not depend on the wall clock. */
  allow(key: string, now?: number): boolean;
}

export function createFixedWindowLimiter(opts: { limit: number; windowMs: number }): FixedWindowLimiter {
  const windows = new Map<string, { windowStart: number; count: number }>();
  return {
    allow(key, now = Date.now()) {
      const existing = windows.get(key);
      if (!existing || now - existing.windowStart >= opts.windowMs) {
        windows.set(key, { windowStart: now, count: 1 });
        return true;
      }
      if (existing.count >= opts.limit) {
        return false;
      }
      existing.count += 1;
      return true;
    },
  };
}
