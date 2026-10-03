import { describe, expect, it } from "vitest";

import { FakeWorker } from "../../../packages/storage/test/fake-worker.js";
import { clearStoredSettings, installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store/index.js");
const { MemoryFileStore } = await import("@typewright/storage");
const { createGlyphs, deleteGlyph, renameCurrentGlyph, setGlyphAdvance } =
  await import("@typewright/tools");

type Store = InstanceType<typeof EditorStore>;

/**
 * What the masters of a family share, carried from the one being drawn.
 *
 * A glyph added while the regular is open has to be in the bold; one renamed
 * has to be renamed there, with the bold's own drawing still under it; the
 * features are the family's and not a master's. All of it is edited through
 * whichever master is open, and these ask that it reaches the rest — when the
 * master is left, and at each other moment the family is taken whole — and
 * that nothing which is a master's own goes with it.
 */

const WEIGHT = { tag: "wght", name: "Weight", min: 100, default: 400, max: 900 };

let fonts = 0;

async function opened(files = new MemoryFileStore(), font?: string): Promise<Store> {
  clearStoredSettings();
  const store = new EditorStore();
  const name = font ?? `share-${String(fonts++)}`;
  await store.connectStorage(new FakeWorker(files) as unknown as Worker, name);
  if (store.getState().ownership === "reading") await store.takeOver();
  return store;
}

/** A regular and a bold made from it, the bold's `o` wider: back in the regular. */
async function family(files = new MemoryFileStore()): Promise<{ store: Store; regular: string }> {
  const store = await opened(files);
  const regular = store.getState().project.current;
  await store.setAxes([WEIGHT]);
  await store.addMaster("bold", "Bold", { wght: 900 });
  await store.switchMaster("bold");
  store.applyTool(setGlyphAdvance(store.editor, "o", 777));
  await store.switchMaster(regular);
  return { store, regular };
}

const names = (store: Store): readonly string[] => store.editor.document.glyphOrder;
const add = (store: Store, name: string): void => {
  store.applyTool(createGlyphs(store.editor, [{ name }], 500));
};

describe("a change made in one master", () => {
  it("adds a glyph to the others when the master is left", async () => {
    const { store } = await family();
    add(store, "fresh");

    await store.switchMaster("bold");

    expect(names(store)).toContain("fresh");
    // And the bold is still the bold.
    expect(store.editor.document.glyphs["o"]!.advance).toBe(777);
  });

  it("renames a glyph in the others, which keep their own drawing of it", async () => {
    const { store } = await family();
    store.setCurrentGlyph("o");
    store.applyTool(renameCurrentGlyph(store.editor, "o.alt"));

    await store.switchMaster("bold");

    expect(names(store)).toContain("o.alt");
    expect(names(store)).not.toContain("o");
    expect(store.editor.document.glyphs["o.alt"]!.advance).toBe(777);
  });

  it("removes a glyph from the others", async () => {
    const { store } = await family();
    store.applyTool(deleteGlyph(store.editor, "e"));

    await store.switchMaster("bold");
    expect(names(store)).not.toContain("e");
  });

  it("carries the features, which are the family's", async () => {
    const { store } = await family();
    store.setFeatures("feature liga { sub o e by o; } liga;");

    await store.switchMaster("bold");
    expect(store.editor.document.features).toBe("feature liga { sub o e by o; } liga;");
  });

  it("carries nothing that was taken back before the master was left", async () => {
    const { store } = await family();
    add(store, "fresh");
    store.undo();

    await store.switchMaster("bold");
    expect(names(store)).not.toContain("fresh");
  });

  it("does not carry a master's own drawing", async () => {
    const { store } = await family();
    store.applyTool(setGlyphAdvance(store.editor, "o", 444));

    await store.switchMaster("bold");
    expect(store.editor.document.glyphs["o"]!.advance).toBe(777);
  });

  it("goes both ways: what the bold changes reaches the regular", async () => {
    const { store, regular } = await family();
    await store.switchMaster("bold");
    add(store, "fromBold");

    await store.switchMaster(regular);
    expect(names(store)).toContain("fromBold");
  });

  it("reaches every master of three", async () => {
    const { store } = await family();
    await store.addMaster("light", "Light", { wght: 100 });
    add(store, "fresh");

    await store.switchMaster("light");
    expect(names(store)).toContain("fresh");
    await store.switchMaster("bold");
    expect(names(store)).toContain("fresh");
  });
});

describe("the other moments a family is taken whole", () => {
  it("carries it when the family is exported, without a master being gone to", async () => {
    const { store } = await family();
    add(store, "fresh");

    const all = await store.allMasters();
    expect(all.find((m) => m.id === "bold")?.document.glyphOrder).toContain("fresh");
  });

  it("carries it when the window closes", async () => {
    const files = new MemoryFileStore();
    const store = await opened(files, "closing");
    const regular = store.getState().project.current;
    await store.setAxes([WEIGHT]);
    await store.addMaster("bold", "Bold", { wght: 900 });
    add(store, "fresh");
    await store.flushNow();

    const again = await opened(files, "closing");
    expect(again.getState().project.current).toBe(regular);
    await again.switchMaster("bold");
    expect(names(again)).toContain("fresh");
  });
});

describe("masters that already differ", () => {
  /** A family whose bold has lost a glyph behind the editor's back. */
  async function apart(): Promise<{ store: Store; files: InstanceType<typeof MemoryFileStore> }> {
    const files = new MemoryFileStore();
    const { store } = await family(files);
    await store.flushNow();

    type Parked = { glyphs: { name: string }[]; info: { glyphOrder?: string[] } };
    const parked = JSON.parse((await files.read("masters/bold.json"))!) as Parked;
    parked.glyphs = parked.glyphs.filter((g) => g.name !== "e");
    if (parked.info.glyphOrder !== undefined) {
      parked.info.glyphOrder = parked.info.glyphOrder.filter((name) => name !== "e");
    }
    await files.write("masters/bold.json", JSON.stringify(parked));
    return { store, files };
  }

  it("are left as they are by a change to something else", async () => {
    const { store } = await apart();
    add(store, "fresh");

    await store.switchMaster("bold");
    // What changed is carried; what already differed is not made to agree.
    expect(names(store)).toContain("fresh");
    expect(names(store)).not.toContain("e");
  });

  it("are said to differ, a part at a time, by the check", async () => {
    const { store } = await apart();

    const checked = await store.compareWith("bold");
    expect(checked?.structure.onlyHere).toEqual(["e"]);
    expect(checked?.structure.onlyThere).toEqual([]);
    expect(checked?.structure.features).toBe(false);
  });

  it("are made to agree in one part, by copying it from the open master", async () => {
    const { store } = await apart();

    await store.copyStructure("bold", "onlyHere");

    expect((await store.compareWith("bold"))?.structure.onlyHere).toEqual([]);
    await store.switchMaster("bold");
    expect(names(store)).toContain("e");
  });

  it("can take the glyphs only another master has, as an edit that can be undone", async () => {
    const { store } = await apart();
    // The other way about: seen from the bold, the regular has a glyph it lacks.
    await store.switchMaster("bold");
    const regular = store.getState().project.masters.find((m) => m.name === "Regular")!.id;
    expect((await store.compareWith(regular))?.structure.onlyThere).toEqual(["e"]);

    await store.copyStructure(regular, "onlyThere");
    expect(names(store)).toContain("e");

    store.undo();
    expect(names(store)).not.toContain("e");
  });
});

describe("a font drawn once", () => {
  it("has nothing to carry, and is not slowed by being asked", async () => {
    const store = await opened();
    add(store, "fresh");
    await store.flushNow();

    expect(names(store)).toContain("fresh");
    expect(store.getState().project.masters).toHaveLength(1);
  });
});
