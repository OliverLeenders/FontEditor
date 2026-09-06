import { describe, expect, it } from "vitest";

import { inParallel } from "../src/parallel.js";

/**
 * A gate every job waits at until it is opened, and freely afterwards.
 *
 * Open once rather than release-what-is-waiting: with one job in flight at a
 * time, the ones that have not started yet are not waiting on anything, and a
 * gate that only released those would leave them there.
 */
function gate() {
  let open = false;
  let opened = (): void => undefined;
  const passed = new Promise<void>((resolve) => {
    opened = resolve;
  });
  return {
    wait: () => (open ? Promise.resolve() : passed),
    open: () => {
      open = true;
      opened();
    },
  };
}

describe("running file work a few at a time", () => {
  it("hands back the results in the order the items were given", async () => {
    // Later items finish first, so anything ordered by completion would differ.
    const out = await inParallel([30, 20, 10], async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(out).toEqual([30, 20, 10]);
  });

  it("keeps no more than the limit in flight", async () => {
    let open = 0;
    let most = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await inParallel(
      items,
      async (i) => {
        open += 1;
        most = Math.max(most, open);
        await Promise.resolve();
        open -= 1;
        return i;
      },
      4,
    );

    expect(most).toBeLessThanOrEqual(4);
    expect(most).toBeGreaterThan(1);
  });

  it("runs them one at a time when asked, and starts the next only when one ends", async () => {
    const held = gate();
    const started: number[] = [];
    const all = inParallel(
      [0, 1, 2],
      async (i) => {
        started.push(i);
        await held.wait();
        return i;
      },
      1,
    );

    await Promise.resolve();
    expect(started).toEqual([0]);
    held.open();
    expect(await all).toEqual([0, 1, 2]);
    expect(started).toEqual([0, 1, 2]);
  });

  it("does nothing for no items", async () => {
    let calls = 0;
    expect(
      await inParallel([], () => {
        calls += 1;
        return Promise.resolve(1);
      }),
    ).toEqual([]);
    expect(calls).toBe(0);
  });

  it("rejects when a job does, the way an awaited loop would", async () => {
    await expect(
      inParallel([1, 2, 3], (n) =>
        n === 2 ? Promise.reject(new Error("no")) : Promise.resolve(n),
      ),
    ).rejects.toThrow("no");
  });
});
