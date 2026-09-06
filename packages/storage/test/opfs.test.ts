import { afterEach, describe, expect, it } from "vitest";

import { OpfsFileStore, requestPersistence } from "../src/opfs.js";

/**
 * The OPFS adapter, against an origin private file system written out here.
 *
 * The rest of the package is tested through `MemoryFileStore`, which is exact
 * about the interface and says nothing about the browser. This is the hundred
 * lines that do touch it: nested directories, sync access handles, and the
 * truncate-before-write that keeps a shorter document from leaving the tail of a
 * longer one behind.
 *
 * The fake is deliberately strict where the real thing is: `getFileHandle`
 * without `create` throws for a file that is not there rather than returning
 * nothing, which is exactly the case the adapter's `try` exists for.
 */

class FakeFile {
  contents = new Uint8Array(0);

  createSyncAccessHandle(): Promise<unknown> {
    return Promise.resolve({
      getSize: () => this.contents.length,
      read: (into: Uint8Array, options: { at: number }) => {
        const slice = this.contents.slice(options.at, options.at + into.length);
        into.set(slice);
        return slice.length;
      },
      write: (bytes: Uint8Array, options: { at: number }) => {
        const end = Math.max(this.contents.length, options.at + bytes.length);
        const next = new Uint8Array(end);
        next.set(this.contents);
        next.set(bytes, options.at);
        this.contents = next;
        return bytes.length;
      },
      truncate: (size: number) => {
        this.contents = this.contents.slice(0, size);
      },
      flush: () => undefined,
      close: () => undefined,
    });
  }
}

class FakeDirectory {
  readonly kind = "directory";
  private readonly entries = new Map<string, FakeDirectory | FakeFile>();

  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectory> {
    const found = this.entries.get(name);
    if (found instanceof FakeDirectory) return Promise.resolve(found);
    if (found !== undefined || options?.create !== true) {
      return Promise.reject(new Error(`no directory ${name}`));
    }
    const made = new FakeDirectory();
    this.entries.set(name, made);
    return Promise.resolve(made);
  }

  getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFile> {
    const found = this.entries.get(name);
    if (found instanceof FakeFile) return Promise.resolve(found);
    if (found !== undefined || options?.create !== true) {
      return Promise.reject(new Error(`no file ${name}`));
    }
    const made = new FakeFile();
    this.entries.set(name, made);
    return Promise.resolve(made);
  }

  removeEntry(name: string): Promise<void> {
    if (!this.entries.has(name)) return Promise.reject(new Error(`no entry ${name}`));
    this.entries.delete(name);
    return Promise.resolve();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<[string, FakeDirectory | FakeFile]> {
    for (const entry of [...this.entries.entries()]) yield entry;
  }
}

/**
 * Node has a `navigator` of its own, and it is a getter — so this replaces it
 * rather than assigning to it, and puts it back afterwards.
 */
function installNavigator(value: unknown): void {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}

function installOpfs(): FakeDirectory {
  const root = new FakeDirectory();
  installNavigator({
    storage: {
      getDirectory: () => Promise.resolve(root),
      persist: () => Promise.resolve(true),
    },
  });
  return root;
}

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

afterEach(() => {
  if (realNavigator === undefined)
    delete (globalThis as unknown as Record<string, unknown>)["navigator"];
  else Object.defineProperty(globalThis, "navigator", realNavigator);
});

describe("the origin private file system store", () => {
  it("refuses to open where the browser has no such thing", async () => {
    installNavigator({});
    await expect(OpfsFileStore.open()).rejects.toThrow(/origin private file system/);
  });

  it("writes and reads a file back", async () => {
    installOpfs();
    const store = await OpfsFileStore.open();

    await store.write("fontinfo.json", '{"unitsPerEm":1000}');
    expect(await store.read("fontinfo.json")).toBe('{"unitsPerEm":1000}');
  });

  it("makes the directories a path implies, and finds them again", async () => {
    installOpfs();
    const store = await OpfsFileStore.open();

    await store.write("glyphs/a.json", "one");
    await store.write("glyphs/deep/b.json", "two");

    expect(await store.read("glyphs/a.json")).toBe("one");
    expect(await store.read("glyphs/deep/b.json")).toBe("two");
    expect((await store.list("glyphs/")).sort()).toEqual(["glyphs/a.json", "glyphs/deep/b.json"]);
  });

  it("reads nothing for a file that is not there, rather than throwing", async () => {
    installOpfs();
    const store = await OpfsFileStore.open();
    expect(await store.read("missing.json")).toBeNull();
    expect(await store.read("no/such/path.json")).toBeNull();
  });

  it("reads an empty file as empty rather than as absent", async () => {
    installOpfs();
    const store = await OpfsFileStore.open();
    await store.write("empty.json", "");
    expect(await store.read("empty.json")).toBe("");
  });

  it("truncates before writing, so a shorter document leaves no tail behind", async () => {
    // Without this the end of the old file is still there, and the result still
    // parses as far as the closing brace.
    installOpfs();
    const store = await OpfsFileStore.open();

    await store.write("a.json", '{"a":1,"b":2,"c":3}');
    await store.write("a.json", '{"a":1}');
    expect(await store.read("a.json")).toBe('{"a":1}');
  });

  it("appends to the end, and starts a file that is not there yet", async () => {
    installOpfs();
    const store = await OpfsFileStore.open();

    await store.append("journal.jsonl", "one\n");
    await store.append("journal.jsonl", "two\n");
    expect(await store.read("journal.jsonl")).toBe("one\ntwo\n");
  });

  it("writes text as UTF-8 and reads it back as it was", async () => {
    installOpfs();
    const store = await OpfsFileStore.open();
    await store.write("glyphs/e%CC%81.json", '{"name":"é","note":"ﬁ ligature"}');
    expect(await store.read("glyphs/e%CC%81.json")).toBe('{"name":"é","note":"ﬁ ligature"}');
  });

  it("removes a file, and takes a file already gone as done", async () => {
    installOpfs();
    const store = await OpfsFileStore.open();

    await store.write("glyphs/a.json", "one");
    await store.remove("glyphs/a.json");
    expect(await store.read("glyphs/a.json")).toBeNull();

    await expect(store.remove("glyphs/a.json")).resolves.toBeUndefined();
    await expect(store.remove("nowhere/at/all.json")).resolves.toBeUndefined();
  });

  it("lists by prefix, walking every directory under the root", async () => {
    installOpfs();
    const store = await OpfsFileStore.open();

    await store.write("glyphs/a.json", "a");
    await store.write("fontinfo.json", "i");
    await store.write("journal.jsonl", "j");

    expect((await store.list("")).sort()).toEqual([
      "fontinfo.json",
      "glyphs/a.json",
      "journal.jsonl",
    ]);
    expect(await store.list("glyphs/")).toEqual(["glyphs/a.json"]);
    expect(await store.list("nothing")).toEqual([]);
  });

  it("opens the directory it is asked for", async () => {
    const root = installOpfs();
    await OpfsFileStore.open("somewhere-else");
    // Created under the root rather than the store writing at the top level,
    // where it would sit among whatever else the origin keeps there.
    await expect(root.getDirectoryHandle("somewhere-else")).resolves.toBeDefined();
  });
});

describe("asking not to be evicted", () => {
  it("reports what the browser said", async () => {
    installOpfs();
    expect(await requestPersistence()).toBe(true);
  });

  it("says no where there is nothing to ask", async () => {
    installNavigator({});
    expect(await requestPersistence()).toBe(false);
  });

  it("says no rather than throwing when the ask itself fails", async () => {
    installNavigator({ storage: { persist: () => Promise.reject(new Error("denied")) } });
    expect(await requestPersistence()).toBe(false);
  });
});
