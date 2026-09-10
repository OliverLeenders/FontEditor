import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DiskFolder } from "../src/handles.js";
import { forgetFolder, recallFolder, rememberFolder } from "../src/remember.js";

/**
 * A small IndexedDB, enough for the three calls `remember.ts` makes.
 *
 * Hand-rolled rather than pulled in: what is exercised here is one `get`, one
 * `put`, one `delete` and the question of which databases exist, and a fake
 * that size is easier to read than the contract of a real one.
 */
class FakeStore {
  constructor(private readonly data: Map<string, unknown>) {}

  get(key: string): unknown {
    return settled(this.data.get(key) ?? null);
  }

  put(value: unknown, key: string): unknown {
    this.data.set(key, value);
    return settled(null);
  }

  delete(key: string): unknown {
    this.data.delete(key);
    return settled(null);
  }
}

function settled(result: unknown): unknown {
  const request = { result, onsuccess: null as null | (() => void), onerror: null };
  queueMicrotask(() => request.onsuccess?.());
  return request;
}

class FakeDatabase {
  readonly stores = new Map<string, Map<string, unknown>>();
  readonly objectStoreNames = { contains: (name: string): boolean => this.stores.has(name) };

  createObjectStore(name: string): void {
    this.stores.set(name, new Map());
  }

  transaction(_name: string, _mode: string): { objectStore: (name: string) => FakeStore } {
    return { objectStore: (name) => new FakeStore(this.stores.get(name) ?? new Map()) };
  }

  close(): void {}
}

class FakeFactory {
  readonly databasesByName = new Map<string, FakeDatabase>();

  databases(): Promise<{ name: string }[]> {
    return Promise.resolve([...this.databasesByName.keys()].map((name) => ({ name })));
  }

  open(name: string): unknown {
    const fresh = !this.databasesByName.has(name);
    const database = this.databasesByName.get(name) ?? new FakeDatabase();
    this.databasesByName.set(name, database);

    const request = {
      result: database,
      onsuccess: null as null | (() => void),
      onupgradeneeded: null as null | (() => void),
      onerror: null,
    };
    queueMicrotask(() => {
      if (fresh) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
}

const folder = (name: string): DiskFolder => ({ name }) as unknown as DiskFolder;

/** What the old version of this editor left behind, in the shape it left it. */
function seedOldDatabase(factory: FakeFactory, name: string): void {
  const database = new FakeDatabase();
  database.createObjectStore("handles");
  database.stores.get("handles")?.set("ufo-folder", {
    folder: folder(name),
    name,
    at: 7,
    wrote: [["glyphs/a.glif", { crc: 1, at: 2 }]],
  });
  factory.databasesByName.set("fonteditor-disk", database);
}

let factory: FakeFactory;
let previous: unknown;

beforeEach(() => {
  factory = new FakeFactory();
  previous = (globalThis as { indexedDB?: unknown }).indexedDB;
  (globalThis as { indexedDB?: unknown }).indexedDB = factory;
});

afterEach(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB = previous;
});

describe("remembering the folder", () => {
  it("reads back what was remembered", async () => {
    await rememberFolder(folder("Source"), new Map([["a.glif", { crc: 3, at: 4 }]]));
    const back = await recallFolder();

    expect(back?.name).toBe("Source");
    expect(back?.wrote).toEqual([["a.glif", { crc: 3, at: 4 }]]);
  });

  it("forgets on request", async () => {
    await rememberFolder(folder("Source"));
    await forgetFolder();
    expect(await recallFolder()).toBeNull();
  });

  it("is null when nothing was ever remembered", async () => {
    expect(await recallFolder()).toBeNull();
  });

  it("does not leave behind a database named after the editor's old name", async () => {
    await recallFolder();
    const names = (await factory.databases()).map((it) => it.name);
    expect(names).not.toContain("fonteditor-disk");
  });
});

describe("a folder remembered before the editor was named", () => {
  it("is found under the old name", async () => {
    seedOldDatabase(factory, "Older");
    const back = await recallFolder();

    expect(back?.name).toBe("Older");
    expect(back?.wrote).toEqual([["glyphs/a.glif", { crc: 1, at: 2 }]]);
  });

  it("is moved across, so the old database is asked once and never again", async () => {
    seedOldDatabase(factory, "Older");
    await recallFolder();

    // Gone from the old database's reach: emptying it changes nothing now.
    factory.databasesByName.delete("fonteditor-disk");
    expect((await recallFolder())?.name).toBe("Older");
  });

  it("gives way to whatever is under the new name", async () => {
    seedOldDatabase(factory, "Older");
    await rememberFolder(folder("Newer"));

    expect((await recallFolder())?.name).toBe("Newer");
  });
});
