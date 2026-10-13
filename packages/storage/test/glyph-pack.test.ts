import { DEFAULT_FONT_INFO, fontDocument, glyph } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { type FileStore, MemoryFileStore } from "../src/file-store.js";
import { GenerationalStore } from "../src/generations.js";
import {
  GLYPH_PACK_PATH,
  JOURNAL_PATH,
  LOOSE_GLYPHS_ALLOWED,
  appendJournalCommit,
  glyphPath,
  loadDocument,
  readHeldMaster,
  removeGlyph,
  repack,
  replaceDocument,
  saveGlyphs,
} from "../src/project.js";
import { encodeFontInfo, encodeGlyph } from "../src/schema.js";

/**
 * A font's glyphs in one file, and the ones changed since beside it.
 *
 * A font written whole is thousands of glyphs, and a file each is thousands of
 * files opened to write — which one browser does in five seconds and another
 * in three minutes. So a whole font is one file, a glyph a line; a glyph
 * changed afterwards is a file of its own, read over its line; and one taken
 * away leaves a file that says so. These ask that the font read back is the
 * same font whichever of those places each glyph is in, that packing again
 * changes nothing but where it is kept, and that a build from before any of
 * this cannot get at it.
 */

const named = (familyName: string, ...names: string[]) =>
  fontDocument(
    names.map((name) => glyph(name, { advance: 500 })),
    { ...DEFAULT_FONT_INFO, familyName },
  );

const wide = (name: string, advance: number) => glyph(name, { advance });

async function read(store: FileStore) {
  const loaded = await loadDocument(store);
  if (loaded.kind === "empty") throw new Error("nothing was read");
  return loaded;
}

async function advances(store: FileStore): Promise<Record<string, number>> {
  const { document } = await read(store);
  return Object.fromEntries(document.glyphOrder.map((n) => [n, document.glyphs[n]!.advance]));
}

/** A working copy as a build from before packing left it: a glyph a file, in a generation. */
async function fromBefore(inner: MemoryFileStore, ...names: string[]): Promise<void> {
  for (const name of names) {
    await inner.write(
      `generation-1/${glyphPath(name)}`,
      JSON.stringify(encodeGlyph(wide(name, 500))),
    );
  }
  await inner.write(
    "generation-1/fontinfo.json",
    JSON.stringify(encodeFontInfo(named("Before", ...names))),
  );
  await inner.write("generation.1", "generation-1\n");
}

describe("a font written whole", () => {
  it("is one file of glyphs, a glyph a line, and no file for any of them", async () => {
    const inner = new MemoryFileStore();
    const store = await GenerationalStore.over(inner);
    await replaceDocument(store, named("Packed", "a", "b", "c"));

    const pack = await inner.read(`packed-1/${GLYPH_PACK_PATH}`);
    expect(pack?.trimEnd().split("\n")).toHaveLength(3);
    expect(await inner.list("packed-1/glyphs/")).toEqual([]);
    expect(store.packed).toBe(true);
    expect((await read(store)).document.glyphOrder).toEqual(["a", "b", "c"]);
  });

  it("is written in as many files however many glyphs it has", async () => {
    const few = new MemoryFileStore();
    await replaceDocument(await GenerationalStore.over(few), named("Few", "a"));
    const many = new MemoryFileStore();
    const names = Array.from({ length: 500 }, (_, i) => `g${String(i)}`);
    await replaceDocument(await GenerationalStore.over(many), named("Many", ...names));

    expect(many.writes.length).toBe(few.writes.length);
  });
});

describe("a glyph changed since the font was packed", () => {
  it("is a file of its own, read over its line in the pack", async () => {
    const inner = new MemoryFileStore();
    const store = await GenerationalStore.over(inner);
    await replaceDocument(store, named("Packed", "a", "b"));

    await saveGlyphs(store, [wide("b", 640), wide("z", 700)]);

    expect(inner.has(`packed-1/${glyphPath("b")}`)).toBe(true);
    expect(await advances(store)).toEqual({ a: 500, b: 640, z: 700 });
    // And the pack is as it was written: an edit does not rewrite the font.
    expect((await inner.read(`packed-1/${GLYPH_PACK_PATH}`))?.includes("640")).toBe(false);
  });

  it("is gone when it is taken away, though its line is still in the pack", async () => {
    const inner = new MemoryFileStore();
    const store = await GenerationalStore.over(inner);
    await replaceDocument(store, named("Packed", "a", "b"));

    await removeGlyph(store, "b");
    expect((await read(store)).document.glyphOrder).toEqual(["a"]);

    // Opened again, which reads the files and nothing remembered.
    const again = await GenerationalStore.over(inner);
    expect((await read(again)).document.glyphOrder).toEqual(["a"]);
  });

  it("comes back when it is drawn again after being taken away", async () => {
    const store = await GenerationalStore.over(new MemoryFileStore());
    await replaceDocument(store, named("Packed", "a", "b"));
    await removeGlyph(store, "b");
    await saveGlyphs(store, [wide("b", 720)]);

    expect(await advances(store)).toEqual({ a: 500, b: 720 });
  });

  it("is still the glyph the pack has where its own file is cut short", async () => {
    const inner = new MemoryFileStore();
    const store = await GenerationalStore.over(inner);
    await replaceDocument(store, named("Packed", "a", "b"));
    await inner.write(`packed-1/${glyphPath("b")}`, '{"name":"b","adv');

    const loaded = await read(store);
    expect(loaded.document.glyphOrder).toEqual(["a", "b"]);
    expect(loaded.problems).toHaveLength(1);
  });

  it("is removed as a file where nothing is packed, as it always was", async () => {
    const store = new MemoryFileStore();
    await saveGlyphs(store, [wide("a", 500), wide("b", 500)]);
    await removeGlyph(store, "b");

    expect(store.has(glyphPath("b"))).toBe(false);
    expect((await read(store)).document.glyphOrder).toEqual(["a"]);
  });
});

describe("a pack that is damaged", () => {
  it("loses the glyph of a line cut short and says so, and keeps the rest", async () => {
    const inner = new MemoryFileStore();
    const store = await GenerationalStore.over(inner);
    await replaceDocument(store, named("Packed", "a", "b", "c"));
    const path = `packed-1/${GLYPH_PACK_PATH}`;
    const pack = (await inner.read(path))!;
    // The last line stopped part of the way through, as a write that was
    // interrupted would leave it.
    await inner.write(path, pack.slice(0, pack.length - 20));

    const loaded = await read(store);
    expect(loaded.document.glyphOrder).toEqual(["a", "b"]);
    expect(loaded.problems).toEqual([`${GLYPH_PACK_PATH}, line 3: file is not valid JSON`]);
  });
});

describe("packing the glyphs again", () => {
  it("is asked for once more of them have files of their own than are allowed", async () => {
    const store = await GenerationalStore.over(new MemoryFileStore());
    await replaceDocument(store, named("Packed", "a"));
    expect((await read(store)).untidy).toBe(false);

    const edited = Array.from({ length: LOOSE_GLYPHS_ALLOWED + 1 }, (_, i) =>
      wide(`g${String(i)}`, 500),
    );
    await saveGlyphs(store, edited.slice(0, LOOSE_GLYPHS_ALLOWED));
    expect((await read(store)).untidy).toBe(false);
    expect(await repack(store)).toBe(false);

    await saveGlyphs(store, edited.slice(LOOSE_GLYPHS_ALLOWED));
    expect((await read(store)).untidy).toBe(true);
  });

  it("leaves the same font, with no glyph in a file of its own", async () => {
    const inner = new MemoryFileStore();
    const store = await GenerationalStore.over(inner);
    await replaceDocument(store, named("Packed", "a", "b", "c"), "bold");
    const edited = Array.from({ length: LOOSE_GLYPHS_ALLOWED }, (_, i) =>
      wide(`g${String(i)}`, 510),
    );
    await saveGlyphs(store, [...edited, wide("b", 640)]);
    await removeGlyph(store, "c");
    const before = await read(store);

    expect(await repack(store)).toBe(true);

    const after = await read(store);
    expect(after.document.glyphs).toEqual(before.document.glyphs);
    expect(after.document.glyphOrder).toEqual(before.document.glyphOrder);
    expect(after.document.info).toEqual(before.document.info);
    expect(after.untidy).toBe(false);
    expect(await readHeldMaster(store)).toBe("bold");
    expect(await inner.list("packed-2/glyphs/")).toEqual([]);
    // The generation it was folded out of is gone, and so is the pointer to it.
    expect(await inner.list("packed-1/")).toEqual([]);
    expect(inner.has("packed.1")).toBe(false);
  });

  it("takes the journal across, so that what was not yet saved is not lost by it", async () => {
    const store = await GenerationalStore.over(new MemoryFileStore());
    await replaceDocument(store, named("Packed", "a", "b"));
    await saveGlyphs(
      store,
      Array.from({ length: LOOSE_GLYPHS_ALLOWED + 1 }, (_, i) => wide(`g${String(i)}`, 500)),
    );
    // Committed and not saved: in the journal and in no glyph's file.
    await appendJournalCommit(store, [wide("a", 999)], ["b"], 1);

    await repack(store);

    const loaded = await read(store);
    expect(loaded.recovered).toBe(true);
    expect(loaded.document.glyphs["a"]?.advance).toBe(999);
    expect(loaded.document.glyphs["b"]).toBeUndefined();
    expect(await store.read(JOURNAL_PATH)).not.toBeNull();
  });

  it("is the font as it was where it stops part of the way", async () => {
    const inner = new MemoryFileStore();
    const whole = await GenerationalStore.over(inner);
    await replaceDocument(whole, named("Packed", "a", "b"));
    await saveGlyphs(
      whole,
      Array.from({ length: LOOSE_GLYPHS_ALLOWED + 1 }, (_, i) => wide(`g${String(i)}`, 500)),
    );
    const before = await advances(whole);

    for (let allowed = 0; allowed < 4; allowed++) {
      let left = allowed;
      const stopping: FileStore = {
        read: (path) => inner.read(path),
        readBytes: (path) => inner.readBytes(path),
        list: (prefix) => inner.list(prefix),
        append: (path, contents) => inner.append(path, contents),
        writeBytes: (path, contents) => inner.writeBytes(path, contents),
        remove: (path) => inner.remove(path),
        write: async (path, contents) => {
          if (left-- <= 0) throw new Error("the tab was closed");
          await inner.write(path, contents);
        },
      };
      const store = await GenerationalStore.over(stopping);
      const done = await repack(store).catch(() => "stopped");

      const again = await GenerationalStore.over(inner);
      expect(await advances(again), `stopped after ${String(allowed)} files`).toEqual(before);
      if (done === true) break;
    }
  });
});

describe("a working copy from before glyphs were packed", () => {
  it("is read as it is, and wants packing", async () => {
    const inner = new MemoryFileStore();
    await fromBefore(inner, "a", "b");
    const store = await GenerationalStore.over(inner);

    const loaded = await read(store);
    expect(loaded.document.glyphOrder).toEqual(["a", "b"]);
    expect(loaded.document.info.familyName).toBe("Before");
    expect(store.packed).toBe(false);
    expect(loaded.untidy).toBe(true);
  });

  it("is packed the same font, and its old generation taken away", async () => {
    const inner = new MemoryFileStore();
    await fromBefore(inner, "a", "b");
    const store = await GenerationalStore.over(inner);
    const before = await read(store);

    expect(await repack(store)).toBe(true);

    const again = await GenerationalStore.over(inner);
    const after = await read(again);
    expect(after.document.glyphs).toEqual(before.document.glyphs);
    expect(after.document.info.familyName).toBe("Before");
    expect(again.packed).toBe(true);
    expect(await inner.list("generation-1/")).toEqual([]);
    expect(inner.has("generation.1")).toBe(false);
    // Numbered past the one it came from, which a build from before may yet use.
    expect(inner.has("packed.2")).toBe(true);
  });

  it("is packed from the top of the working copy too, where it was never in a generation", async () => {
    const inner = new MemoryFileStore();
    await saveGlyphs(inner, [wide("a", 500), wide("b", 500)]);
    const store = await GenerationalStore.over(inner);

    expect(await repack(store)).toBe(true);
    expect(inner.has(glyphPath("a"))).toBe(false);
    expect((await read(store)).document.glyphOrder).toEqual(["a", "b"]);
  });

  it("is not packed where there is no font in it", async () => {
    const store = await GenerationalStore.over(new MemoryFileStore());
    expect(await repack(store)).toBe(false);
  });
});

describe("a build from before glyphs were packed, let at a packed working copy", () => {
  it("is not the font, whatever it wrote beside it, and what it wrote is cleared away", async () => {
    const inner = new MemoryFileStore();
    await replaceDocument(await GenerationalStore.over(inner), named("Mine", "a", "b"));

    // What that build does: it knows no generation here, takes the working
    // copy for an empty one, and writes the font it starts people with — at
    // the top, and then, replaced whole, into generations of its own.
    await inner.write(glyphPath("o"), JSON.stringify(encodeGlyph(wide("o", 600))));
    await inner.write("fontinfo.json", JSON.stringify({ schema: 1, glyphOrder: ["o"] }));
    await fromBefore(inner, "o");
    await inner.write(
      `generation-7/${glyphPath("o")}`,
      JSON.stringify(encodeGlyph(wide("o", 600))),
    );
    await inner.write("generation.7", "generation-7\n");

    const store = await GenerationalStore.over(inner);
    const loaded = await read(store);
    expect(loaded.document.info.familyName).toBe("Mine");
    expect(loaded.document.glyphOrder).toEqual(["a", "b"]);

    expect(inner.has(glyphPath("o"))).toBe(false);
    expect(inner.has("fontinfo.json")).toBe(false);
    expect(await inner.list("generation-")).toEqual([]);
    expect(await inner.list("generation.")).toEqual([]);

    // And the next generation is numbered past everything that build used.
    await replaceDocument(store, named("Next", "c"));
    expect(inner.has("packed.8")).toBe(true);
  });
});
