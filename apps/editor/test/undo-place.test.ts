import { describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store/index.js");
const { createGlyphs, renameCurrentGlyph } = await import("@typewright/tools");

/**
 * Where the editor is after a step is taken back.
 *
 * A step taken back changes the font under the editor, and may take away the
 * glyph it was on: one just made is gone again, one just renamed has its old
 * name back. The editor stayed on the name that was no longer in the font — an
 * empty canvas and an inspector with nothing in it, where the letter had been.
 */
describe("the glyph being drawn, after a step in the history", () => {
  const onAGlyph = (store: InstanceType<typeof EditorStore>): boolean =>
    store.editor.document.glyphs[store.editor.currentGlyph] !== undefined;

  it("is the same glyph under its old name when a rename is taken back", () => {
    const store = new EditorStore();
    store.setCurrentGlyph("o");
    const drawn = store.editor.document.glyphs["o"]!.contours;

    store.applyTool(renameCurrentGlyph(store.editor, "o.alt"));
    expect(store.editor.currentGlyph).toBe("o.alt");

    store.undo();
    expect(store.editor.currentGlyph).toBe("o");
    expect(store.editor.document.glyphs[store.editor.currentGlyph]!.contours).toBe(drawn);

    store.redo();
    expect(store.editor.currentGlyph).toBe("o.alt");
    expect(onAGlyph(store)).toBe(true);
  });

  it("is a glyph the font has when the making of one is taken back", () => {
    const store = new EditorStore();
    store.applyTool(createGlyphs(store.editor, [{ name: "fresh" }], 500));
    expect(store.editor.currentGlyph).toBe("fresh");

    store.undo();
    expect(store.editor.document.glyphs["fresh"]).toBeUndefined();
    expect(onAGlyph(store)).toBe(true);

    store.redo();
    expect(onAGlyph(store)).toBe(true);
  });

  it("is a glyph the font has wherever in the history the list is clicked", () => {
    const store = new EditorStore();
    store.setCurrentGlyph("o");
    store.applyTool(renameCurrentGlyph(store.editor, "o.alt"));
    store.applyTool(createGlyphs(store.editor, [{ name: "fresh" }], 500));
    store.applyTool(renameCurrentGlyph(store.editor, "fresher"));

    for (const step of [0, 3, 1, 2, 0, 3]) {
      store.goToStep(step);
      expect(onAGlyph(store), `at step ${String(step)}`).toBe(true);
    }
    store.goToStep(0);
    expect(store.editor.document.glyphOrder).not.toContain("o.alt");
  });
});
