import { describe, expect, it } from "vitest";

import type { LockGrant, LockManagerLike } from "../src/lock.js";
import { projectLock } from "../src/lock.js";
import {
  type WorkingRoot,
  deleteWorkingCopy,
  forgottenCopies,
  workingCopies,
} from "../src/working-copies.js";

/**
 * Removing a font's working copy, which is the one thing in this package that
 * cannot be taken back — so most of what is tested is when it does *not* happen.
 */

/** The root of an origin private file system, holding directories by name. */
class FakeRoot implements WorkingRoot {
  readonly names = new Set<string>();
  readonly removed: { name: string; recursive: boolean }[] = [];

  constructor(names: readonly string[]) {
    for (const name of names) this.names.add(name);
  }

  async *keys(): AsyncGenerator<string> {
    for (const name of [...this.names]) yield await Promise.resolve(name);
  }

  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.names.has(name)) return Promise.reject(new Error(`no entry ${name}`));
    this.names.delete(name);
    this.removed.push({ name, recursive: options?.recursive === true });
    return Promise.resolve();
  }
}

/** Web Locks, with the named locks some other window is holding. */
class FakeLocks implements LockManagerLike {
  constructor(private readonly heldElsewhere: readonly string[] = []) {}

  async request(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: LockGrant) => Promise<unknown>,
  ): Promise<unknown> {
    if (this.heldElsewhere.includes(name)) {
      if (options.ifAvailable === true) return await callback(null);
      throw new Error("a real request would wait here");
    }
    return await callback({ name });
  }
}

const A = "3f2b8c1e-9d4a-4b6f-8e2d-1a7c5b9e0f34";
const B = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

describe("the working copies there are", () => {
  it("are the directories at the root", async () => {
    expect((await workingCopies(new FakeRoot(["project", A]))).sort()).toEqual([A, "project"]);
  });

  it("are none where there is no private file system", async () => {
    expect(await workingCopies(null)).toEqual([]);
  });
});

describe("removing a working copy", () => {
  it("removes one nobody has open, with everything inside it", async () => {
    const root = new FakeRoot([A, B]);

    expect(await deleteWorkingCopy(A, { root, locks: new FakeLocks() })).toBe("deleted");
    expect([...root.names]).toEqual([B]);
    expect(root.removed).toEqual([{ name: A, recursive: true }]);
  });

  it("leaves one alone that another window has open", async () => {
    const root = new FakeRoot([A]);
    const locks = new FakeLocks([projectLock(A)]);

    expect(await deleteWorkingCopy(A, { root, locks })).toBe("in-use");
    expect([...root.names]).toEqual([A]);
  });

  it("asks about that font's lock and no other", async () => {
    // Another font being open somewhere is no reason to keep this one.
    const root = new FakeRoot([A, B]);
    const locks = new FakeLocks([projectLock(B)]);

    expect(await deleteWorkingCopy(A, { root, locks })).toBe("deleted");
  });

  it("says so when there is nothing by that name", async () => {
    expect(await deleteWorkingCopy(A, { root: new FakeRoot([]), locks: new FakeLocks() })).toBe(
      "missing",
    );
  });

  it("touches nothing without a private file system", async () => {
    expect(await deleteWorkingCopy(A, { root: null, locks: new FakeLocks() })).toBe("unavailable");
  });

  it("touches nothing without locks, rather than guess nobody is writing", async () => {
    const root = new FakeRoot([A]);

    expect(await deleteWorkingCopy(A, { root, locks: null })).toBe("unavailable");
    expect([...root.names]).toEqual([A]);
  });
});

describe("which working copies are forgotten", () => {
  it("are the ones no font refers to", () => {
    expect(forgottenCopies([A, B], new Set([A]))).toEqual([B]);
  });

  it("never include the working copy that predates ids", () => {
    expect(forgottenCopies(["project"], new Set())).toEqual([]);
  });

  it("never include a directory this editor would not have named", () => {
    expect(forgottenCopies(["somebody-elses", "backup", "p1"], new Set())).toEqual([]);
  });

  it("include the fallback ids minted where there is no randomUUID", () => {
    expect(forgottenCopies(["pmf4kz1x9q2abc"], new Set())).toEqual(["pmf4kz1x9q2abc"]);
  });
});
