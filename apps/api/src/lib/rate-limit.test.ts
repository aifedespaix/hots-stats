import { describe, expect, test } from "bun:test";
import { createFixedWindowLimiter } from "./rate-limit";

describe("createFixedWindowLimiter", () => {
  test("allows up to the limit inside one window", () => {
    const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 1000 });
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 100)).toBe(true);
    expect(limiter.allow("a", 200)).toBe(true);
  });

  test("rejects the request past the limit", () => {
    const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1000 });
    limiter.allow("a", 0);
    limiter.allow("a", 1);
    expect(limiter.allow("a", 2)).toBe(false);
  });

  test("resets once the window elapses", () => {
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 500)).toBe(false);
    expect(limiter.allow("a", 1000)).toBe(true);
  });

  test("keys are independent", () => {
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("b", 0)).toBe(true);
    expect(limiter.allow("a", 1)).toBe(false);
  });
});
