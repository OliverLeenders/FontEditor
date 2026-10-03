import { DEFAULT_FONT_INFO, fontDocument, glyph } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { StorageClient } from "../src/client.js";
import {
  type FileRead,
  MemoryFileStore,
  PROGRESS_EVERY,
  type ReadProgress,
  readAll,
} from "../src/file-store.js";
import { GenerationalStore } from "../src/generations.js";
import { loadDocument, replaceDocument, saveDocument } from "../src/project.js";
import type { StorageProgress, StorageRequest, StorageResponse } from "../src/protocol.js";
import { storageHandler } from "../src/worker.js";

/**
 * Reading a font's glyphs in one go, and saying how far that has got.
 *
 * A font of four thousand glyphs is four thousand files, and seconds of
 * reading. These ask that the fast way of reading a folder is used where a
 * store has one and gives what the slow way gives, and that how far it has got
 * reaches whoever asked — through the store, the worker and the client.
 */

const font = (count: number) =>
  fontDocument(
    Array.from({ length: count }, (_, i) => glyph(`g${String(i)}`, { advance: 500 + i })),
    { ...DEFAULT_FONT_INFO, familyName: "Many" },
  );

/** A store that has the fast way, and counts how often it was asked for. */
class Fast extends MemoryFileStore {
  asked = 0;

  async readFolder(folder: string, progress?: ReadProgress): Promise<FileRead[]> {
    this.asked += 1;
    const paths = await this.list(folder);
    const out: FileRead[] = [];
    for (const path of paths) out.push({ path, raw: (await this.read(path))! });
    progress?.(paths.length, paths.length);
    return out;
  }
}

describe("reading a folder whole", () => {
  it("reads every file the slow way where a store has no other", async () => {
    const store = new MemoryFileStore();
    await store.write("glyphs/a.json", "A");
    await store.write("glyphs/b.json", "B");
    await store.write("fontinfo.json", "{}");

    const read = await readAll(store, "glyphs/");
    expect(read).toEqual([
      { path: "glyphs/a.json", raw: "A" },
      { path: "glyphs/b.json", raw: "B" },
    ]);
  });

  it("says how far it has got, and that it has finished", async () => {
    const store = new MemoryFileStore();
    const total = PROGRESS_EVERY * 2 + 5;
    for (let i = 0; i < total; i++) await store.write(`glyphs/${String(i)}.json`, "{}");

    const said: [number, number][] = [];
    await readAll(store, "glyphs/", (done, of) => said.push([done, of]));

    expect(said.at(-1)).toEqual([total, total]);
    // Now and then, not once for every file.
    expect(said.length).toBeGreaterThan(1);
    expect(said.length).toBeLessThan(10);
    expect(said.every(([, of]) => of === total)).toBe(true);
  });

  it("uses a store's own way where it has one", async () => {
    const store = new Fast();
    await saveDocument(store, font(3), null);

    const loaded = await loadDocument(store);
    expect(store.asked).toBe(1);
    expect(loaded.kind === "loaded" && loaded.document.glyphOrder).toEqual(["g0", "g1", "g2"]);
  });

  it("reads a generation's glyphs under the names the rest of storage uses", async () => {
    const inner = new Fast();
    const store = await GenerationalStore.over(inner);
    await replaceDocument(store, font(3));

    const read = await store.readFolder("glyphs/");
    expect(inner.asked).toBe(1);
    expect(read.map((file) => file.path).sort()).toEqual((await store.list("glyphs/")).sort());
    expect(read.every((file) => file.path.startsWith("glyphs/"))).toBe(true);

    const loaded = await loadDocument(store);
    expect(loaded.kind === "loaded" && loaded.document.info.familyName).toBe("Many");
  });
});

describe("how far a load has got", () => {
  it("is said by the worker before its reply, under the request's id", async () => {
    const store = new MemoryFileStore();
    await saveDocument(store, font(PROGRESS_EVERY + 1), null);

    const said: StorageProgress[] = [];
    const handle = storageHandler(
      () => Promise.resolve(store),
      (progress) => said.push(progress),
    );
    await handle({ id: 1, kind: "open", directory: "p" });
    const reply = await handle({ id: 2, kind: "load" });

    expect(reply.ok).toBe(true);
    expect(said.length).toBeGreaterThan(0);
    expect(said.every((it) => it.id === 2)).toBe(true);
    expect(said.at(-1)!.progress).toEqual({ done: PROGRESS_EVERY + 1, total: PROGRESS_EVERY + 1 });
  });

  it("reaches whoever asked the client, and the font still arrives once", async () => {
    const store = new MemoryFileStore();
    await saveDocument(store, font(PROGRESS_EVERY + 1), null);

    // A worker in so far as the client needs one: it answers, and says how far
    // it has got on the way.
    const listeners = new Set<(event: { data: StorageResponse | StorageProgress }) => void>();
    const post = (data: StorageResponse | StorageProgress): void => {
      for (const listener of listeners) listener({ data });
    };
    const handle = storageHandler(() => Promise.resolve(store), post);
    const worker = {
      addEventListener: (type: string, listener: never) => {
        if (type === "message") listeners.add(listener);
      },
      postMessage: (request: StorageRequest) => void handle(request).then(post),
    };

    const client = new StorageClient(worker as unknown as Worker);
    await client.open("p");
    const said: [number, number][] = [];
    const loaded = await client.load((done, total) => said.push([done, total]));

    expect(said.at(-1)).toEqual([PROGRESS_EVERY + 1, PROGRESS_EVERY + 1]);
    expect(loaded.kind === "loaded" && loaded.document.glyphOrder).toHaveLength(PROGRESS_EVERY + 1);
  });
});
