import { DEFAULT_FONT_INFO, fontDocument, glyph } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { type FileStore, MemoryFileStore } from "../src/file-store.js";
import type { StorageRequest } from "../src/protocol.js";
import { encodeFontInfo, encodeGlyph } from "../src/schema.js";
import { storageHandler } from "../src/worker.js";

/**
 * The worker answering one request at a time.
 *
 * In a browser each file is read and written through an access handle, and a
 * file can have only one open: a second is refused. Answered side by side, a
 * load reading the project and a font being written over it opened the same
 * file twice, and storage gave up — which is what a font opened a moment after
 * a reload ran into. This store refuses the same way, and takes its time, so
 * two requests answered together would meet in it.
 */
class OneHandlePerFile implements FileStore {
  private readonly open = new Set<string>();
  readonly inner = new MemoryFileStore();

  private async holding<T>(path: string, work: () => Promise<T>): Promise<T> {
    if (this.open.has(path)) {
      throw new Error("Access Handles cannot be created if there is another open Access Handle");
    }
    this.open.add(path);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return await work();
    } finally {
      this.open.delete(path);
    }
  }

  read(path: string): Promise<string | null> {
    return this.holding(path, () => this.inner.read(path));
  }
  readBytes(path: string): Promise<Uint8Array | null> {
    return this.holding(path, () => this.inner.readBytes(path));
  }
  write(path: string, contents: string): Promise<void> {
    return this.holding(path, () => this.inner.write(path, contents));
  }
  writeBytes(path: string, contents: Uint8Array): Promise<void> {
    return this.holding(path, () => this.inner.writeBytes(path, contents));
  }
  append(path: string, contents: string): Promise<void> {
    return this.holding(path, () => this.inner.append(path, contents));
  }
  remove(path: string): Promise<void> {
    return this.inner.remove(path);
  }
  list(prefix: string): Promise<string[]> {
    return this.inner.list(prefix);
  }
}

describe("the storage worker", () => {
  it("answers requests one at a time, so two never open one file together", async () => {
    const store = new OneHandlePerFile();
    const handle = storageHandler(() => Promise.resolve(store));
    const font = fontDocument(
      Array.from({ length: 20 }, (_, i) => glyph(`g${String(i)}`, { advance: 500 })),
      DEFAULT_FONT_INFO,
    );

    expect((await handle({ id: 1, kind: "open", directory: "project" })).ok).toBe(true);
    // The font's info written first, as a project already on disk would have it.
    await handle({ id: 2, kind: "saveFontInfo", info: encodeFontInfo(font) });

    // A load and a font written over it, asked for together, as a reload and a
    // font opened straight after it ask for them.
    const asked: StorageRequest[] = [
      { id: 3, kind: "load" },
      { id: 4, kind: "saveGlyphs", glyphs: Object.values(font.glyphs).map(encodeGlyph) },
      { id: 5, kind: "saveFontInfo", info: encodeFontInfo(font) },
      { id: 6, kind: "load" },
    ];
    const replies = await Promise.all(asked.map((request) => handle(request)));

    expect(replies.map((r) => (r.ok ? "ok" : r.reason))).toEqual(["ok", "ok", "ok", "ok"]);
    // And in the order they were asked.
    expect(replies.map((r) => r.id)).toEqual([3, 4, 5, 6]);
  });

  it("goes on answering after a request that failed", async () => {
    const handle = storageHandler(() => Promise.resolve(new MemoryFileStore()));
    // Nothing is open yet, so this one fails.
    const failed = await handle({ id: 1, kind: "load" });
    expect(failed.ok).toBe(false);
    expect((await handle({ id: 2, kind: "open", directory: "project" })).ok).toBe(true);
    expect((await handle({ id: 3, kind: "load" })).ok).toBe(true);
  });
});
