import { DEFAULT_FONT_INFO, fontDocument, glyph } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { type FileStore, MemoryFileStore } from "../src/file-store.js";
import { GenerationalStore } from "../src/generations.js";
import { glyphPath, loadDocument, replaceDocument, saveGlyphs, wipe } from "../src/project.js";

/**
 * Replacing a whole font in one step.
 *
 * Opening a font writes thousands of files over the one in the working copy.
 * Stopped part of the way — a reload, a crash — it used to leave half of each
 * font, and opened that without a word. These ask that a replacement is the
 * old font until it is finished and the new one after, and nothing between.
 */

const named = (familyName: string, ...names: string[]) =>
  fontDocument(
    names.map((name) => glyph(name, { advance: 500 })),
    { ...DEFAULT_FONT_INFO, familyName },
  );

async function familyIn(store: FileStore): Promise<string | null> {
  const loaded = await loadDocument(store);
  return loaded.kind === "empty" ? null : loaded.document.info.familyName;
}

async function namesIn(store: FileStore): Promise<string[]> {
  const loaded = await loadDocument(store);
  return loaded.kind === "empty" ? [] : [...loaded.document.glyphOrder].sort();
}

describe("a font replaced whole", () => {
  it("is written into a generation of its own, and the rest of the working copy stays", async () => {
    const inner = new MemoryFileStore();
    await inner.write("snapshots/one.json", "{}");
    const store = await GenerationalStore.over(inner);

    await replaceDocument(store, named("First", "a", "b"));

    expect(await familyIn(store)).toBe("First");
    expect(inner.has(`generation-1/${glyphPath("a")}`)).toBe(true);
    expect(inner.has("generation.1")).toBe(true);
    // Not part of a font's replacement, so not moved.
    expect(inner.has("snapshots/one.json")).toBe(true);
  });

  it("takes the old generation away once the new one is in place", async () => {
    const inner = new MemoryFileStore();
    const store = await GenerationalStore.over(inner);
    await replaceDocument(store, named("First", "a", "b"));
    await replaceDocument(store, named("Second", "c"));

    expect(await namesIn(store)).toEqual(["c"]);
    expect((await inner.list("generation-1/")).length).toBe(0);
    expect(inner.has("generation.1")).toBe(false);
  });

  it("goes on saving into the generation that is current", async () => {
    const inner = new MemoryFileStore();
    const store = await GenerationalStore.over(inner);
    await replaceDocument(store, named("First", "a"));
    await saveGlyphs(store, [glyph("z", { advance: 600 })]);

    expect(inner.has(`generation-1/${glyphPath("z")}`)).toBe(true);
    expect(await namesIn(store)).toEqual(["a", "z"]);
  });

  it("is still the old font when the replacement stops part of the way", async () => {
    const inner = new MemoryFileStore();
    const first = await GenerationalStore.over(inner);
    await replaceDocument(first, named("First", "a", "b"));

    // A store that stops after a few files, as a reload does.
    let allowed = 3;
    const stopping: FileStore = {
      ...inner,
      read: (path) => inner.read(path),
      readBytes: (path) => inner.readBytes(path),
      list: (prefix) => inner.list(prefix),
      append: (path, contents) => inner.append(path, contents),
      writeBytes: (path, contents) => inner.writeBytes(path, contents),
      remove: (path) => inner.remove(path),
      write: async (path, contents) => {
        if (allowed-- <= 0) throw new Error("the tab was closed");
        await inner.write(path, contents);
      },
    };
    const interrupted = await GenerationalStore.over(stopping);
    await expect(
      replaceDocument(interrupted, named("Second", "c", "d", "e", "f", "g")),
    ).rejects.toThrow("the tab was closed");

    // Opened again: the first font, whole, and the half-written one gone.
    const again = await GenerationalStore.over(inner);
    expect(await familyIn(again)).toBe("First");
    expect(await namesIn(again)).toEqual(["a", "b"]);
    expect((await inner.list("generation-2/")).length).toBe(0);
  });

  it("does not take a pointer cut off as it was written for a whole one", async () => {
    const inner = new MemoryFileStore();
    const store = await GenerationalStore.over(inner);
    await replaceDocument(store, named("First", "a"));
    // The next generation written, and its pointer stopped half way.
    await inner.write(`generation-2/${glyphPath("x")}`, "{}");
    await inner.write("generation.2", "generat");

    const again = await GenerationalStore.over(inner);
    expect(await familyIn(again)).toBe("First");
    expect(inner.has("generation.2")).toBe(false);
  });

  it("reads a working copy from before generations, and moves it into one when replaced", async () => {
    const inner = new MemoryFileStore();
    // As this editor wrote it before: the font's files at the top.
    await replaceDocument(inner, named("Old", "a"));
    expect(inner.has(glyphPath("a"))).toBe(true);

    const store = await GenerationalStore.over(inner);
    expect(await familyIn(store)).toBe("Old");

    await replaceDocument(store, named("New", "b"));
    expect(await familyIn(store)).toBe("New");
    expect(inner.has(glyphPath("a"))).toBe(false);
    expect(inner.has("fontinfo.json")).toBe(false);
  });
});

describe("a working copy emptied", () => {
  it("starts again at the top, and what is written after it survives being opened again", async () => {
    const inner = new MemoryFileStore();
    const store = await GenerationalStore.over(inner);
    await replaceDocument(store, named("First", "a"));
    await wipe(store);
    expect(await inner.list("")).toEqual([]);

    await saveGlyphs(store, [glyph("b", { advance: 500 })]);
    const again = await GenerationalStore.over(inner);
    expect(await namesIn(again)).toEqual(["b"]);
  });
});
