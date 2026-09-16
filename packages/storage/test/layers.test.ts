import { describe, expect, it } from "vitest";

import { MemoryFileStore } from "../src/file-store.js";
import { LAYERS_PATH, type StoredLayer, readLayers, writeLayers } from "../src/layers.js";
import { DESIGNSPACE_PATH, readDesignspace, writeDesignspace } from "../src/masters.js";

/**
 * The layers of the source this editor does not edit.
 *
 * Kept out of the document for the reason the pictures are — a second set of
 * glyphs is the size of the first, and the document is a value history copies
 * on every edit — and kept *on disk* because the save that would drop them is
 * the one after a reload.
 */

const layer = (name: string, directory: string): StoredLayer => ({
  name,
  directory,
  files: [
    { path: "contents.plist", text: "<plist><dict/></plist>" },
    { path: "a.glif", text: '<glyph name="a"/>' },
  ],
});

describe("keeping the layers", () => {
  it("writes them and reads them back exactly", async () => {
    const store = new MemoryFileStore();
    const layers = [layer("sketch", "glyphs.sketch"), layer("old", "glyphs.old")];

    await writeLayers(store, layers);

    expect(await readLayers(store)).toEqual(layers);
  });

  it("has nothing to say about a font with one layer", async () => {
    const store = new MemoryFileStore();
    expect(await readLayers(store)).toEqual([]);
  });

  it("writes no file for a font with no extra layers", async () => {
    const store = new MemoryFileStore();
    await writeLayers(store, []);
    expect(await store.read(LAYERS_PATH)).toBeNull();
  });

  it("clears what a previous font left behind", async () => {
    // Opening a font that has no layers must not leave the last one's sketch
    // where the next save would write it back out.
    const store = new MemoryFileStore();
    await writeLayers(store, [layer("sketch", "glyphs.sketch")]);

    await writeLayers(store, []);

    expect(await readLayers(store)).toEqual([]);
  });

  it("treats a file it cannot read as nothing rather than as a failure", async () => {
    // Losing the drawing to save the sketch would be the wrong way round: this
    // is data the editor never understood, so there is no repair to attempt.
    const store = new MemoryFileStore();
    await store.write(LAYERS_PATH, "{not json");
    expect(await readLayers(store)).toEqual([]);

    await store.write(LAYERS_PATH, JSON.stringify({ schema: 1, layers: "sketch" }));
    expect(await readLayers(store)).toEqual([]);
  });

  it("drops an entry that is not shaped like a layer, and keeps the ones that are", async () => {
    const store = new MemoryFileStore();
    const good = layer("sketch", "glyphs.sketch");
    await store.write(
      LAYERS_PATH,
      JSON.stringify({
        schema: 1,
        layers: [{ name: "half" }, good, { directory: "x", files: [] }],
      }),
    );

    expect(await readLayers(store)).toEqual([good]);
  });

  it("keeps which master of a family each layer's file is", async () => {
    const store = new MemoryFileStore();
    const ours = { ...layer("sketch", "glyphs.sketch"), master: "m1" };
    await writeLayers(store, [ours, layer("old", "glyphs.old")]);
    expect((await readLayers(store)).map((l) => l.master)).toEqual(["m1", undefined]);

    // A master that is not a name is not believed.
    await store.write(LAYERS_PATH, JSON.stringify({ schema: 1, layers: [{ ...ours, master: 7 }] }));
    expect(await readLayers(store)).toEqual([]);
  });
});

describe("keeping the designspace", () => {
  const base = {
    axes: [{ tag: "wght", name: "Weight", min: 20, default: 80, max: 220, map: [[100, 20]] }],
    masters: [{ id: "m1", name: "Regular", location: { wght: 80 } }],
    current: "m1",
    instances: [],
  } as const;

  it("keeps the rules, their order of application, and what the file said besides", async () => {
    const store = new MemoryFileStore();
    const rules = [
      {
        id: "r",
        name: "heavy",
        conditionSets: [[{ tag: "wght", min: 150, max: null }]],
        swaps: [["dollar", "dollar.heavy"] as const],
      },
    ];
    const kept = { attributes: { format: "5.0" }, children: ["<lib/>"] };
    await writeDesignspace(store, { ...base, rules, rulesProcessing: "last", kept });

    const read = await readDesignspace(store);
    expect(read?.axes[0]?.map).toEqual([[100, 20]]);
    expect(read?.rules).toEqual(rules);
    expect(read?.rulesProcessing).toBe("last");
    expect(read?.kept).toEqual(kept);
  });

  it("reads a project written before rules were kept as one with none", async () => {
    const store = new MemoryFileStore();
    await store.write(DESIGNSPACE_PATH, JSON.stringify({ schema: 1, ...base }));

    const read = await readDesignspace(store);
    expect(read?.rules).toEqual([]);
    expect(read?.rulesProcessing).toBe("first");
    expect(read?.kept).toBeNull();
  });
});
