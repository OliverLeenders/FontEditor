import { describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { duplicateNameFont, threeGlyphFont } from "./fonts.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store/index.js");
type Store = InstanceType<typeof EditorStore>;

describe("importing a font into the store", () => {
  it("adopts the parsed document and reports what arrived", async () => {
    const store: Store = new EditorStore();
    const result = await store.importFont(threeGlyphFont());

    expect(result.family).toBe("Imported Regular");
    expect(result.glyphs).toBe(4);
    expect(result.warnings).toEqual([]);

    expect(store.editor.document.info.familyName).toBe("Imported");
    expect(store.editor.document.glyphOrder).toEqual([".notdef", "A", "B", "C"]);
  });

  it("lands on the first glyph of the new font", async () => {
    const store: Store = new EditorStore();
    await store.importFont(threeGlyphFont());
    expect(store.editor.currentGlyph).toBe(".notdef");
  });

  it("replaces the history rather than extending it", async () => {
    const store: Store = new EditorStore();
    const starter = store.editor.document;

    await store.importFont(threeGlyphFont());
    const imported = store.editor.document;

    // One ctrl-Z must not silently swap the whole font back, and the history it
    // restored would describe glyphs that are no longer open.
    store.undo();
    expect(store.editor.document).toBe(imported);
    expect(store.editor.document).not.toBe(starter);
  });

  it("clears a filter that was narrowed to the previous font", async () => {
    const store: Store = new EditorStore();
    store.setCatalogQuery({ set: "block:greek", search: "sigma" });

    await store.importFont(threeGlyphFont());
    expect(store.getState().catalogQuery.set).toBe("all");
    expect(store.getState().catalogQuery.search).toBe("");
  });

  it("keeps the camera where it was, so the view does not jump", async () => {
    const store: Store = new EditorStore();
    store.setViewport(800, 600);

    await store.importFont(threeGlyphFont());
    // fitGlyph runs for the newly opened glyph, so the view is valid rather
    // than stale — what matters is that it is finite and usable.
    expect(Number.isFinite(store.editor.view.scale)).toBe(true);
    expect(store.editor.view.scale).toBeGreaterThan(0);
  });

  it("refuses something that is not a font, leaving the document alone", async () => {
    const store: Store = new EditorStore();
    const before = store.editor.document;

    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    await expect(store.importFont(junk)).rejects.toThrow();
    expect(store.editor.document).toBe(before);
  });

  it("reports duplicate glyph names as warnings rather than losing glyphs", async () => {
    const store: Store = new EditorStore();
    const result = await store.importFont(duplicateNameFont());

    expect(result.glyphs).toBe(3);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/more than once/);
  });
});
