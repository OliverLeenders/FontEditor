import { beforeEach, describe, expect, it } from "vitest";

import { clearStoredSettings, installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store/index.js");
const { setPointType, deleteSelectedPoints, begin, commit } = await import("@typewright/tools");
const { glyphBounds, sidebearings, updateGlyph } = await import("@typewright/font-model");

type Store = InstanceType<typeof EditorStore>;

/** A store on the starter font, with no storage worker attached. */
function freshStore(): Store {
  clearStoredSettings();
  return new EditorStore();
}

/** Select every on-curve point of the current glyph. */
function selectAllPoints(store: Store): void {
  const glyph = store.editor.document.glyphs[store.editor.currentGlyph];
  store.setEditor({
    ...store.editor,
    selection: (glyph?.contours ?? []).flatMap((c) =>
      c.nodes.map((n) => ({ contourId: c.id, nodeId: n.id, part: "point" as const })),
    ),
  });
}

describe("EditorStore", () => {
  let store: Store;
  beforeEach(() => {
    store = freshStore();
  });

  it("starts on the first glyph of the starter font", () => {
    expect(store.editor.document.glyphOrder.length).toBeGreaterThan(0);
    expect(store.editor.currentGlyph).toBe(store.editor.document.glyphOrder[0]);
  });

  it("notifies subscribers when state changes, and not when it does not", () => {
    let calls = 0;
    const stop = store.subscribe(() => calls++);

    store.setCurrentGlyph(store.editor.document.glyphOrder[1]!);
    expect(calls).toBeGreaterThan(0);

    const settled = calls;
    // Selecting the glyph that is already current is not a change.
    store.setCurrentGlyph(store.editor.currentGlyph);
    expect(calls).toBe(settled);

    stop();
    store.setCurrentGlyph(store.editor.document.glyphOrder[0]!);
    expect(calls).toBe(settled);
  });

  it("clears selection and focus when the glyph changes", () => {
    selectAllPoints(store);
    store.setEditor({
      ...store.editor,
      focusedSegment: { contourId: "c", segmentIndex: 0 },
    });
    expect(store.editor.selection.length).toBeGreaterThan(0);

    store.setCurrentGlyph(store.editor.document.glyphOrder[1]!);
    expect(store.editor.selection).toEqual([]);
    expect(store.editor.focusedSegment).toBeNull();
  });

  describe("undo and redo", () => {
    it("restores the document a tool edit replaced", () => {
      selectAllPoints(store);
      const before = store.editor.document;

      store.applyTool(setPointType(store.editor, "corner"));
      expect(store.editor.document).not.toBe(before);

      store.undo();
      // Reference equality, not deep equality: the persistent model means undo
      // hands back the very object, which is what the whole design rests on.
      expect(store.editor.document).toBe(before);
    });

    it("redoes what it undid", () => {
      selectAllPoints(store);
      store.applyTool(setPointType(store.editor, "corner"));
      const edited = store.editor.document;

      store.undo();
      store.redo();
      expect(store.editor.document).toBe(edited);
    });

    it("does nothing when there is nothing to undo", () => {
      const before = store.editor.document;
      store.undo();
      store.undo();
      expect(store.editor.document).toBe(before);
    });

    it("records no entry for a tool call that changed nothing", () => {
      // Nothing selected, so setting a point type is a no-op.
      const before = store.editor.document;
      store.applyTool(setPointType(store.editor, "smooth"));
      store.undo();
      expect(store.editor.document).toBe(before);
    });

    it("names what it would undo", () => {
      selectAllPoints(store);
      store.applyTool(deleteSelectedPoints(store.editor));
      expect(store.undoLabel()).toMatch(/Delete point/);
    });
  });

  describe("saving while a gesture is in flight", () => {
    /** The same document with one glyph a unit wider: a change, cheaply made. */
    const widened = (store: Store) => {
      const name = store.editor.currentGlyph;
      const document = updateGlyph(store.editor.document, name, (g) => ({
        ...g,
        advance: g.advance + 1,
      }))!;
      return { ...store.editor, document };
    };

    it("waits for the gesture to finish before telling autosave", () => {
      // Every pointer move of a drag makes a new document, and none of them is a
      // step the user could undo to. Journalling each one wrote the glyph to
      // disk a hundred times a second for states nobody asked to keep.
      store.applyTool({ state: widened(store), effects: [begin("Drag")] });
      expect(store.getState().saveStatus).toBe("idle");

      store.applyTool({ state: widened(store), effects: [] });
      expect(store.getState().saveStatus).toBe("idle");

      store.applyTool({ state: widened(store), effects: [commit] });
      expect(store.getState().saveStatus).toBe("pending");
    });

    it("tells it at once for an edit that is not a gesture", () => {
      selectAllPoints(store);
      store.applyTool(deleteSelectedPoints(store.editor));
      expect(store.getState().saveStatus).toBe("pending");
    });

    it("wakes its listeners once per tool call, not twice", () => {
      // Two patches per call meant every pointer move redrew the canvas and
      // re-ran every selector twice.
      let calls = 0;
      const stop = store.subscribe(() => calls++);
      store.applyTool({ state: widened(store), effects: [begin("Drag"), commit] });
      stop();
      expect(calls).toBe(1);
    });
  });

  describe("newFont", () => {
    it("replaces the document with an empty one and starts a fresh history", async () => {
      selectAllPoints(store);
      store.applyTool(deleteSelectedPoints(store.editor));

      await store.newFont();

      expect(store.editor.document.glyphOrder).toEqual([".notdef"]);
      expect(store.editor.currentGlyph).toBe(".notdef");
      // The previous font is gone for good; undo must not resurrect it.
      store.undo();
      expect(store.editor.document.glyphOrder).toEqual([".notdef"]);
    });

    it("resets the browser filter, which may have been narrowed to the old font", async () => {
      store.setCatalogQuery({ set: "block:greek", search: "omega" });
      await store.newFont();
      expect(store.getState().catalogQuery.set).toBe("all");
      expect(store.getState().catalogQuery.search).toBe("");
    });
  });

  describe("catalog query", () => {
    it("merges partial changes", () => {
      store.setCatalogQuery({ search: "a" });
      store.setCatalogQuery({ order: "name" });
      expect(store.getState().catalogQuery).toMatchObject({ search: "a", order: "name" });
    });

    it("does not notify when nothing actually changed", () => {
      let calls = 0;
      store.subscribe(() => calls++);
      store.setCatalogQuery({ search: "" });
      expect(calls).toBe(0);
    });
  });

  describe("view preferences", () => {
    it("hides handles by default, and toggles", () => {
      expect(store.getState().views[0].autoHideHandles).toBe(true);
      store.toggleAutoHideHandles();
      expect(store.getState().views[0].autoHideHandles).toBe(false);
    });

    it("changes the pane it is told about and leaves the other", () => {
      store.toggleCurvature(1);
      expect(store.getState().views[1].showCurvature).toBe(true);
      expect(store.getState().views[0].showCurvature).toBe(false);
    });

    it("keeps the inspector on screen when the window is small", () => {
      store.moveInspector(5000, 5000);
      expect(store.getState().inspector.x).toBeLessThanOrEqual(1200);
      expect(store.getState().inspector.y).toBeLessThanOrEqual(800);
    });

    it("never puts the inspector at a negative position", () => {
      store.moveInspector(-500, -500);
      expect(store.getState().inspector.x).toBe(0);
      expect(store.getState().inspector.y).toBe(0);
    });
  });

  describe("stepping through the font", () => {
    it("moves to the next glyph and back again, in the font's own order", () => {
      const order = store.editor.document.glyphOrder;
      const first = order[0]!;

      store.setCurrentGlyph(first);
      store.stepGlyph(1);
      expect(store.editor.currentGlyph).toBe(order[1]);

      store.stepGlyph(-1);
      expect(store.editor.currentGlyph).toBe(first);
    });

    it("stops at either end rather than wrapping round", () => {
      // Arriving back at the first glyph from the last reads as a bug the first
      // three times it happens.
      const order = store.editor.document.glyphOrder;

      store.setCurrentGlyph(order[0]!);
      store.stepGlyph(-1);
      expect(store.editor.currentGlyph).toBe(order[0]);

      store.setCurrentGlyph(order[order.length - 1]!);
      store.stepGlyph(1);
      expect(store.editor.currentGlyph).toBe(order[order.length - 1]);
    });
  });

  describe("fitGlyph", () => {
    it("does nothing before the canvas has a size", () => {
      const before = store.editor.view;
      store.fitGlyph();
      expect(store.editor.view).toBe(before);
    });

    it("frames the em box once the viewport is known", () => {
      store.setViewport(800, 600);
      const view = store.editor.view;
      expect(view.scale).toBeGreaterThan(0);
      expect(Number.isFinite(view.tx)).toBe(true);
      expect(Number.isFinite(view.ty)).toBe(true);
    });

    it("waits for a size worth fitting to", () => {
      // A canvas measured before the page has laid out is zero, which the
      // surface reports as 1×1. Fitting a glyph to a one-pixel window is a zoom
      // nobody wants — and taking that as "the first viewport" left the real
      // size, a frame later, counting as not the first, so the glyph opened off
      // screen until somebody pressed ctrl-0.
      store.setViewport(1, 1);
      const unfitted = store.editor.view;

      store.setViewport(800, 600);
      expect(store.editor.view).not.toBe(unfitted);
      expect(store.editor.view.scale).toBeLessThan(1);
    });

    it("does not refit when the window is merely resized", () => {
      store.setViewport(800, 600);
      const view = store.editor.view;
      store.setViewport(900, 700);
      // Framing again under the reader would move the drawing while they work.
      expect(store.editor.view).toBe(view);
    });

    it("ignores a viewport that has not changed", () => {
      store.setViewport(800, 600);
      const view = store.editor.view;
      store.setViewport(800, 600);
      // The feedback loop this guards against redrew sixty times a second.
      expect(store.editor.view).toBe(view);
    });
  });
});

describe("the starter font", () => {
  it("has glyphs with real outlines and sane sidebearings", () => {
    const store = freshStore();
    const drawn = Object.values(store.editor.document.glyphs).filter((g) => g.contours.length > 0);
    expect(drawn.length).toBeGreaterThan(0);

    for (const g of drawn) {
      const box = glyphBounds(g);
      expect(box).not.toBeNull();
      const sb = sidebearings(g);
      expect(sb).not.toBeNull();
      // A glyph whose outline runs past its advance is a spacing bug, not a style.
      expect(sb!.right).toBeGreaterThan(-g.advance);
    }
  });
});

describe("keeping copies of the font", () => {
  it("keeps none while there is no storage to keep them in", async () => {
    // The editor works without a store, and so does this: it keeps nothing and
    // says so, rather than failing the edit that asked for it.
    const store = freshStore();
    await store.snapshot();
    expect(store.getState().snapshots).toEqual([]);
  });

  it("has nothing to restore from a copy that is not there", async () => {
    const store = freshStore();
    expect(await store.restoreSnapshot(1)).toBeNull();
  });
});
