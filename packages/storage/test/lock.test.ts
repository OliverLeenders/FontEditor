import { describe, expect, it } from "vitest";

import { type LockGrant, type LockManagerLike, ProjectLock } from "../src/lock.js";

/**
 * A Web Locks stand-in, faithful in the two behaviours that matter: only one
 * holder at a time, and a steal that breaks the current holder by rejecting the
 * request it is waiting on.
 */
class FakeLocks implements LockManagerLike {
  private holder: { reject: (reason: unknown) => void } | null = null;

  async request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: LockGrant) => Promise<unknown>,
  ): Promise<unknown> {
    if (this.holder !== null && options.steal !== true) {
      if (options.ifAvailable === true) return callback(null);
      // Queuing is not exercised here; a real wait would hang the test.
      throw new Error("lock is held");
    }

    if (this.holder !== null && options.steal === true) {
      this.holder.reject(new DOMException("stolen", "AbortError"));
      this.holder = null;
    }

    return new Promise((resolve, reject) => {
      this.holder = { reject };
      void callback({ name }).then(
        () => {
          this.holder = null;
          resolve(undefined);
        },
        reject,
      );
    });
  }

  get taken(): boolean {
    return this.holder !== null;
  }
}

describe("ProjectLock", () => {
  it("grants the lock to the first tab", async () => {
    const locks = new FakeLocks();
    const first = new ProjectLock(locks, () => {});
    expect(await first.tryAcquire()).toBe(true);
    expect(first.held).toBe(true);
  });

  it("refuses a second tab rather than queueing it", async () => {
    const locks = new FakeLocks();
    const first = new ProjectLock(locks, () => {});
    const second = new ProjectLock(locks, () => {});

    await first.tryAcquire();
    expect(await second.tryAcquire()).toBe(false);
    expect(second.held).toBe(false);
  });

  it("hands the lock on when the owner releases it", async () => {
    const locks = new FakeLocks();
    const first = new ProjectLock(locks, () => {});
    const second = new ProjectLock(locks, () => {});

    await first.tryAcquire();
    first.releaseLock();
    expect(first.held).toBe(false);
    await new Promise((r) => setTimeout(r, 0));

    expect(await second.tryAcquire()).toBe(true);
  });

  it("lets a second tab take over, and tells the first it lost it", async () => {
    const locks = new FakeLocks();
    let lost = 0;
    const first = new ProjectLock(locks, () => lost++);
    const second = new ProjectLock(locks, () => {});

    await first.tryAcquire();
    expect(await second.steal()).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    // The first tab must know, or it carries on writing over the new owner.
    expect(lost).toBe(1);
    expect(first.held).toBe(false);
    expect(second.held).toBe(true);
  });

  it("does not report a loss for a tab that never held it", async () => {
    const locks = new FakeLocks();
    let lost = 0;
    const first = new ProjectLock(locks, () => {});
    const second = new ProjectLock(locks, () => lost++);

    await first.tryAcquire();
    await second.tryAcquire(); // refused
    await new Promise((r) => setTimeout(r, 0));
    expect(lost).toBe(0);
  });

  it("is a no-op acquire when it already holds the lock", async () => {
    const locks = new FakeLocks();
    const lock = new ProjectLock(locks, () => {});
    expect(await lock.tryAcquire()).toBe(true);
    expect(await lock.tryAcquire()).toBe(true);
    expect(lock.held).toBe(true);
  });

  it("carries on as sole owner where the browser has no Web Locks", async () => {
    // Losing coordination is bad; refusing to save anything is worse.
    const lock = new ProjectLock(null, () => {});
    expect(await lock.tryAcquire()).toBe(true);
  });
});
