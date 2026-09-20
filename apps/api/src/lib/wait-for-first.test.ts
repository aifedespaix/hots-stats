import { describe, expect, test } from "bun:test";
import { waitForFirst } from "./wait-for-first";

describe("waitForFirst", () => {
  test("resolves with the first pushed value and unsubscribes", async () => {
    let unsubscribed = false;
    const value = await waitForFirst<number>(
      (deliver) => {
        queueMicrotask(() => deliver(42));
        return () => {
          unsubscribed = true;
        };
      },
      1_000,
    );

    expect(value).toBe(42);
    expect(unsubscribed).toBe(true);
  });

  test("resolves null after the timeout and unsubscribes", async () => {
    let unsubscribed = false;
    const started = Date.now();

    const value = await waitForFirst<number>(
      () => () => {
        unsubscribed = true;
      },
      20,
    );

    expect(value).toBeNull();
    expect(unsubscribed).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  test("resolves null when the signal aborts", async () => {
    const controller = new AbortController();
    const promise = waitForFirst<number>(() => () => {}, 10_000, controller.signal);
    controller.abort();

    expect(await promise).toBeNull();
  });

  test("ignores deliveries that arrive after it has settled", async () => {
    let deliver!: (value: number) => void;
    const value = await waitForFirst<number>((sink) => {
      deliver = sink;
      return () => {};
    }, 10);

    expect(value).toBeNull();
    // Must be a no-op rather than re-resolving or throwing.
    deliver(1);
  });
});
